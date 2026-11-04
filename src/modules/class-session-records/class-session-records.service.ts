import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClassSessionRecord,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import { RequestContext } from '@database/schema-manager/request-context';
import { assertSchemaName } from '@database/schema-manager/schema-name';
import { PrismaService } from '@database/prisma/prisma.service';
import { SchemaManagerService } from '@database/schema-manager/schema-manger.service';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import {
  json,
  RecordContext,
  SessionActor,
  SessionPrincipal,
  SessionTx,
} from './session.types';
import {
  SessionPeopleQueryDto,
  SessionQueryDto,
  SessionWorkspaceQueryDto,
  UpdateSessionDto,
} from './session.dto';
import { syncPartObservations } from './part-observations';
import { workspaceColumns, WorkspaceRow } from './session-workspace';
import { observationMetadata } from './observation-metadata';
import { createHash } from 'node:crypto';
import { assertPartTeacherAvailable, teacherAvailabilitySql } from '../operations/teacher-availability';

@Injectable()
export class ClassSessionRecordsService {
  constructor(
    readonly prisma: PrismaService,
    private readonly requestContext: RequestContext,
    private readonly schemas: SchemaManagerService,
  ) {}

  async context(principal: SessionPrincipal): Promise<RecordContext> {
    this.assertRole(principal.role);
    const state = this.requestContext.require();
    const selected =
      principal.role === Role.ADMIN
        ? state.routing?.adminSchema
        : state.routing?.userSchema;
    if (
      !selected ||
      state.schema !== selected ||
      selected === 'public' ||
      selected === 'core_schema'
    ) {
      throw new ForbiddenException('Seleccione un proceso académico operativo');
    }
    await this.schemas.assertAvailable(selected);
    // JwtStrategy validates the signed schema, active account and revocation.
    const origin = principal.role === Role.ADMIN ? 'core_schema' : selected;
    const account = await this.prisma
      .getClientForSchema(origin)
      .user.findUnique({ where: { id: principal.userId } });
    if (
      !account?.isActive ||
      (account.role as Role) !== principal.role ||
      account.email !== principal.email
    )
      throw new ForbiddenException('Cuenta o rol no vigente');
    const actor: SessionActor = {
      id: account.id,
      email: account.email,
      role: principal.role,
      origin,
      schema: selected,
    };
    return {
      client: this.prisma.getClientForSchema(selected),
      schema: selected,
      actor,
    };
  }

  assertRole(role: string): asserts role is Role {
    if (![Role.ADMIN, Role.MONITOR, Role.SUPERVISOR].includes(role as Role))
      throw new ForbiddenException('Rol sin acceso operativo a partes');
  }

  admin(actor: SessionActor) {
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException('Operación administrativa');
  }

  async transaction<T>(
    client: PrismaClient,
    schema: string,
    work: (tx: SessionTx) => Promise<T>,
    timeout = 5000,
  ): Promise<T> {
    assertSchemaName(schema);
    // PrismaPg qualifies ORM queries, not raw SQL. Pin the path on this transaction only.
    return client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('search_path',${`"${schema}"`},true)`;
        return work(tx);
      },
      { timeout },
    );
  }

  async scope(
    tx: SessionTx,
    actor: SessionActor,
  ): Promise<Prisma.ClassSessionRecordWhereInput> {
    this.assertRole(actor.role);
    if (actor.role === Role.ADMIN) return {};
    if (actor.role === Role.MONITOR) return { monitorAccountId: actor.id };
    const supervisor = await tx.supervisor.findUnique({
      where: { userId: actor.id },
    });
    if (!supervisor) throw new ForbiddenException('Supervisor no registrado');
    return { supervisorId: supervisor.id };
  }

  async authorizeRecord(
    tx: SessionTx,
    actor: SessionActor,
    id: number,
    write = false,
    allowDeleted = false,
    reason?: string,
  ): Promise<ClassSessionRecord> {
    this.assertRole(actor.role);
    const record = await tx.classSessionRecord.findFirst({
      where: {
        id,
        ...(await this.scope(tx, actor)),
        ...(allowDeleted && actor.role === Role.ADMIN
          ? {}
          : { deletedAt: null }),
      },
    });
    if (!record) throw new NotFoundException('Parte no encontrado');
    if (write) await this.assertWritable(tx, actor, record, reason);
    return record;
  }

  async now(tx: SessionTx): Promise<Date> {
    const [row] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT session_clock_now() AS now`;
    return row.now;
  }

  editStartsAt(
    record: Pick<
      ClassSessionRecord,
      'scheduledStart' | 'period' | 'editOpensAt'
    >,
  ): Date {
    return new Date(
      record.editOpensAt ??
        +record.scheduledStart - (record.period === 1 ? 5 * 60_000 : 0),
    );
  }

  async assertWritable(
    tx: SessionTx,
    actor: SessionActor,
    record: ClassSessionRecord,
    reason?: string,
  ) {
    await tx.$queryRaw`SELECT set_config('cepr.session_account',${actor.id},true)`;
    await tx.$queryRaw`SELECT set_config('cepr.session_reason',${reason?.trim() ?? ''},true)`;
    const now = await this.now(tx);
    if (record.deletedAt) throw new ForbiddenException('Parte anulado');
    if (now < this.editStartsAt(record))
      throw new ForbiddenException(
        'La edición del bloque todavía no está habilitada',
      );
    if (now < record.editDeadline) return;
    const grant = await tx.sessionEditGrant.findFirst({
      where: {
        recordId: record.id,
        accountId: actor.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (grant) {
      this.reason(reason);
      return;
    }
    throw new ForbiddenException(
      'Plazo cerrado: solo administración puede corregir el parte con un motivo',
    );
  }

  async lock(tx: SessionTx, id: number) {
    await tx.$queryRaw`SELECT id FROM class_session_records WHERE id=${id} FOR UPDATE`;
  }

  version(record: ClassSessionRecord, expected: number) {
    if (record.version !== expected)
      throw new ConflictException('Versión desactualizada');
  }

  async audit(
    tx: SessionTx,
    actor: SessionActor,
    recordId: number | null,
    action: string,
    before: unknown,
    after: unknown,
    reason?: string,
  ) {
    const event = await tx.sessionAuditEvent.create({
      data: {
        recordId,
        action,
        actor: json(actor),
        before: before == null ? Prisma.DbNull : json(before),
        after: after == null ? Prisma.DbNull : json(after),
        reason,
      },
    });
    if (recordId !== null && action !== 'MATERIALIZED' && !action.startsWith('ALERT_') && !action.includes('UPLOAD') && !action.includes('ACCESS')) {
      const record = await tx.classSessionRecord.findUnique({ where: { id: recordId }, select: { version: true } });
      await tx.$executeRaw`SELECT pg_notify('operations_changed',${JSON.stringify({ schema: actor.schema, recordId, version: action.startsWith('EDIT_') || action.startsWith('REVIEW') ? 0 : record?.version ?? 0 })})`;
    }
    return event;
  }

  async mutate(
    principal: SessionPrincipal,
    id: number,
    expected: number,
    action: string,
    reason: string | undefined,
    change: (
      tx: SessionTx,
      record: ClassSessionRecord,
      actor: SessionActor,
    ) => Promise<Prisma.ClassSessionRecordUncheckedUpdateInput>,
    administrative = false,
    operation?: { id: string; hash: string },
  ) {
    const { client, actor } = await this.context(principal);
    if (actor.role === Role.ADMIN) this.reason(reason);
    return this.transaction(client, actor.schema, async (tx) => {
      if (operation)
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.schema + ':part-proposal:' + operation.id},0))::text`;
      await this.lock(tx, id);
      const record = await this.authorizeRecord(
        tx,
        actor,
        id,
        false,
        administrative,
        reason,
      );
      if (administrative) {
        this.admin(actor);
        this.reason(reason);
      }
      if (operation) {
        const existing = await tx.sessionCoverage.findFirst({
          where: { kind: 'TEACHER', operationId: operation.id },
        });
        if (existing) {
          const requester = existing.requestedBy as unknown as SessionActor;
          if (
            existing.proposalHash !== operation.hash ||
            requester.id !== actor.id ||
            requester.role !== actor.role ||
            requester.origin !== actor.origin ||
            requester.schema !== actor.schema
          )
            throw new ConflictException(
              'Operación ya utilizada para otra intención',
            );
          return this.projectRecord(tx, actor, record);
        }
      }
      if (!administrative) await this.assertWritable(tx, actor, record, reason);
      if (administrative)
        await tx.$queryRaw`SELECT set_config('cepr.session_override','true',true)`;
      this.version(record, expected);
      const data = await change(tx, record, actor);
      // Recheck after validations/uploads: the original deadline is never moved.
      if (!administrative) await this.assertWritable(tx, actor, record, reason);
      const updated = await tx.classSessionRecord.update({
        where: { id, version: expected },
        data: { ...data, version: { increment: 1 } },
      });
      await this.audit(tx, actor, id, action, record, updated, reason);
      if (data.structuredObservations !== undefined && JSON.stringify(record.structuredObservations) !== JSON.stringify(updated.structuredObservations))
        await this.notifyRecord(tx, actor, updated, 'observations.changed', `observations:${updated.version}`, 'Observaciones de clase actualizadas', true);
      if (record.classState !== updated.classState && updated.classState === 'T')
        await this.notifyRecord(tx, actor, updated, 'lateness.declared', `lateness:${updated.version}`, 'Tardanza declarada; no implica sanción', false);
      if (['actualStart','actualEnd','initialFileId','finalFileId','teachingStatus','deletedAt'].some(key => JSON.stringify(record[key as keyof ClassSessionRecord]) !== JSON.stringify(updated[key as keyof ClassSessionRecord])))
        await tx.$executeRaw`SELECT pg_notify('operations_changed',${JSON.stringify({schema:actor.schema})})`;
      return this.projectRecord(tx, actor, updated);
    });
  }

  private async projectRecord(tx: SessionTx, actor: SessionActor, record: ClassSessionRecord) {
    const now = await this.now(tx);
    const [coverages, reviews, grant, files] = await Promise.all([
      tx.sessionCoverage.findMany({ where: { recordId: record.id, status: { in: ['PENDING', 'AUTHORIZED'] } } }),
      tx.sessionReview.findMany({ where: { recordId: record.id, recordVersion: record.version }, take: 1 }),
      tx.sessionEditGrant.findFirst({ where: { recordId: record.id, accountId: actor.id, revokedAt: null, expiresAt: { gt: now } }, orderBy: { expiresAt: 'desc' } }),
      tx.file.findMany({ where: { id: { in: [record.initialFileId, record.finalFileId].filter((id): id is string => !!id) } }, select: { id:true, generation:true, status:true } }),
    ]);
    const capture = (id: string | null) => { const file = files.find(file => file.id === id); return file ? { fileId: file.id, generation:file.generation, status:file.status } : null; };
    const opens = this.editStartsAt(record), ordinary = now >= opens && now < record.editDeadline;
    const exceptional = now >= opens && !ordinary && !!grant;
    return { ...record, coverages, reviews, grants:grant ? [grant] : [], initialCapture:capture(record.initialFileId), finalCapture:capture(record.finalFileId), completeness:this.completeness(record), reviewStatus:reviews[0]?.result ?? 'PENDING', policy: { editOpensAt:opens, editDeadline:record.editDeadline, grant, canEdit:!record.deletedAt && (actor.role === Role.ADMIN || ordinary || exceptional), requiresReason:actor.role === Role.ADMIN || exceptional, canReview:actor.role === Role.SUPERVISOR, canResolveReplacement:actor.role === Role.ADMIN, canFollowMonitor:actor.role !== Role.MONITOR, canGrant:actor.role === Role.ADMIN } };
  }

  reason(reason?: string): asserts reason is string {
    if (!reason || reason.trim().length < 3)
      throw new BadRequestException('Se requiere un motivo');
  }

  range(query: Pick<SessionQueryDto, 'from' | 'to'>) {
    const from = new Date(query.from),
      to = new Date(query.to);
    if (
      !Number.isFinite(+from) ||
      !Number.isFinite(+to) ||
      to < from ||
      +to - +from > 93 * 86400000
    )
      throw new BadRequestException('Rango máximo de 93 días');
    return { gte: from, lte: to };
  }

  async where(
    tx: SessionTx,
    actor: SessionActor,
    query: SessionQueryDto,
  ): Promise<Prisma.ClassSessionRecordWhereInput> {
    if (query.includeDeleted === 'true') this.admin(actor);
    return {
      ...(await this.scope(tx, actor)),
      date: this.range(query),
      deletedAt: query.includeDeleted === 'true' ? undefined : null,
      classId: query.classId,
      effectiveTeacherId: query.teacherId,
      titularMonitorId: query.monitorId,
      shiftId: query.shiftId,
      courseId: query.courseId,
    };
  }

  async journals(
    principal: SessionPrincipal,
    query: Pick<SessionQueryDto, 'from' | 'to' | 'page' | 'limit'>,
  ) {
    const { client, actor } = await this.context(principal);
    if (actor.role !== Role.MONITOR)
      throw new ForbiddenException('Listado de jornadas exclusivo del monitor');
    const range = this.range(query);
    const [result] = await this.transaction(
      client,
      actor.schema,
      (tx) => tx.$queryRaw<{ data: unknown[]; total: number }[]>`
      WITH journals AS (
        SELECT date::text AS date, class_id AS "classId", shift_id AS "shiftId",
          min(snapshot->>'className') AS "className", min(snapshot->>'shift') AS shift,
          min(scheduled_start) AS "scheduledStart", max(scheduled_end) AS "scheduledEnd", count(*)::int AS blocks
        FROM class_session_records
        WHERE monitor_account_id=${actor.id}::uuid AND deleted_at IS NULL
          AND date BETWEEN ${range.gte}::date AND ${range.lte}::date
        GROUP BY date, class_id, shift_id
      )
      SELECT (SELECT count(*)::int FROM journals) AS total,
        COALESCE((SELECT json_agg(page) FROM (
          SELECT * FROM journals ORDER BY date DESC, "classId", "shiftId"
          OFFSET ${(query.page - 1) * query.limit} LIMIT ${query.limit}
        ) page), '[]'::json) AS data`,
    );
    return { ...result, page: query.page, limit: query.limit };
  }

  async list(principal: SessionPrincipal, query: SessionQueryDto) {
    const { client, actor } = await this.context(principal);
    const where = await this.where(client, actor, query);
    if (query.pendingReview === 'true') {
      // Same-row version comparison is expressed in SQL; no unbounded client filtering.
      const reviewed = await this.transaction(client, actor.schema, (tx) =>
        tx.$queryRaw<
          { id: number }[]
        >(Prisma.sql`SELECT r.id FROM class_session_records r WHERE r.date BETWEEN ${new Date(query.from)}::date AND ${new Date(query.to)}::date
          ${actor.role === Role.MONITOR ? Prisma.sql`AND r.monitor_account_id=${actor.id}::uuid` : Prisma.empty}
          ${actor.role === Role.SUPERVISOR ? Prisma.sql`AND r.supervisor_id=(SELECT id FROM supervisors WHERE user_id=${actor.id}::uuid)` : Prisma.empty}
          AND EXISTS (SELECT 1 FROM session_reviews v WHERE v.record_id=r.id AND v.record_version=r.version)`),
      );
      where.id = { notIn: reviewed.map((r) => r.id) };
    }
    const [data, total] = await client.$transaction([
      client.classSessionRecord.findMany({
        where,
        orderBy: [{ date: 'asc' }, { scheduledStart: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          coverages: { where: { status: { in: ['PENDING', 'AUTHORIZED'] } } },
          reviews: { orderBy: { id: 'desc' }, take: 1 },
        },
      }),
      client.classSessionRecord.count({ where }),
    ]);
    return {
      data: data.map((r) => ({
        ...r,
        completeness: this.completeness(r),
        reviewStatus:
          r.reviews[0]?.recordVersion === r.version
            ? r.reviews[0].result
            : 'PENDING',
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async workspace(
    principal: SessionPrincipal,
    query: SessionWorkspaceQueryDto,
  ) {
    const { client, actor } = await this.context(principal);
    return this.transaction(client, actor.schema, async (tx) => {
      const now = await this.now(tx);
      const date =
        query.date ??
        new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(
          now,
        );
      const scope =
        actor.role === Role.MONITOR
          ? Prisma.sql`AND r.monitor_account_id=${actor.id}::uuid`
          : actor.role === Role.SUPERVISOR
            ? Prisma.sql`AND r.supervisor_id=(SELECT id FROM supervisors WHERE user_id=${actor.id}::uuid)`
            : Prisma.empty;
      const currentScope =
        actor.role === Role.MONITOR
          ? Prisma.sql`AND m.user_id=${actor.id}::uuid`
          : actor.role === Role.SUPERVISOR
            ? Prisma.sql`AND m.supervisor_id=(SELECT id FROM supervisors WHERE user_id=${actor.id}::uuid)`
            : Prisma.empty;
      const classes = await tx.$queryRaw<
        { id: string; name: string; shiftId: number }[]
      >`
        SELECT DISTINCT ON (id) id,name,"shiftId" FROM (
          SELECT r.class_id id,r.snapshot->>'className' name,r.shift_id "shiftId",0 priority
          FROM class_session_records r WHERE r.deleted_at IS NULL AND r.date=${new Date(date)}::date ${scope}
          UNION ALL SELECT c.id,c.name,c.shift_id,1 FROM classes c LEFT JOIN monitors m ON m.id=c.monitor_id WHERE true ${currentScope}
        ) options ORDER BY id,priority,name`;
      classes.sort(
        (a, b) =>
          (a.name ?? '').localeCompare(b.name ?? '') ||
          a.id.localeCompare(b.id),
      );
      if (query.classId && !classes.some((c) => c.id === query.classId))
        throw new NotFoundException('Jornada no encontrada');
      const selectedClass =
        classes.find((c) => c.id === query.classId) ?? classes[0];
      if (query.shiftId && selectedClass && query.shiftId !== selectedClass.shiftId)
        throw new NotFoundException('Jornada no encontrada');
      const selection = {
        date,
        classId: selectedClass?.id ?? null,
        shiftId: query.shiftId ?? selectedClass?.shiftId ?? null,
      };
      if (!selection.classId || !selection.shiftId) {
        const [courses, shifts] = await Promise.all([
          tx.course.findMany({
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          }),
          tx.shift.findMany({
            select: { id: true, name: true },
            orderBy: { id: 'asc' },
          }),
        ]);
        return {
          context: {
            accountId: actor.id,
            process: actor.schema,
            role: actor.role,
            serverNow: now.toISOString(),
            timeZone: 'America/Lima',
            operationalDate: new Intl.DateTimeFormat('en-CA', {
              timeZone: 'America/Lima',
            }).format(now),
          },
          selection,
          options: { classes, courses, shifts },
          rows: [],
          policy: {
            canFollowMonitor: actor.role !== Role.MONITOR,
            canGrant: actor.role === Role.ADMIN,
            configurationPending: false,
          },
          summary: { pending: 0, nextUpdateAt: null },
          ...(actor.role === Role.MONITOR
            ? {}
            : {
                monitorFollowup: {
                  observations: [],
                  total: 0,
                  page: 1,
                  limit: 25,
                },
              }),
        };
      }
      const [raw, courses, shifts, config] = await Promise.all([
        tx.$queryRaw<
          Record<string, unknown>[]
        >`SELECT r.* FROM v_class_session_records_workspace r
          WHERE r.deleted_at IS NULL AND r.date=${new Date(date)}::date AND r.class_id=${selection.classId}::uuid
          AND r.shift_id=${selection.shiftId} ${scope} ORDER BY r.scheduled_start,r.period,r.id`,
        tx.course.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        tx.shift.findMany({
          select: { id: true, name: true },
          orderBy: { id: 'asc' },
        }),
        tx.sessionOperationalConfig.findUniqueOrThrow({ where: { id: 1 } }),
      ]);
      const rows = raw.map((row) => workspaceColumns<WorkspaceRow>(row));
      const grants = await tx.sessionEditGrant.findMany({
        where: {
          recordId: { in: rows.map((r) => r.id) },
          accountId: actor.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { expiresAt: 'desc' },
      });
      const projected = rows.map((row) => {
        const grant = grants.find((g) => g.recordId === row.id) ?? null;
        const opens = this.editStartsAt(row);
        const ordinary = now >= opens && now < row.editDeadline;
        const exceptional = now >= opens && !ordinary && grant !== null;
        const { teacherCoverage, monitorCoverage, currentReview, ...base } = row;
        return {
          ...base,
          coverages: [teacherCoverage, monitorCoverage]
            .filter((c) => c !== null)
            .map((c) => workspaceColumns<Record<string, unknown>>(c)),
          reviews: currentReview
            ? [workspaceColumns<Record<string, unknown>>(currentReview)]
            : [],
          grants: grant ? [grant] : [],
          completeness: this.completeness(row),
          reviewStatus: currentReview?.result ?? 'PENDING',
          policy: {
            editOpensAt: opens,
            editDeadline: row.editDeadline,
            grant,
            canEdit:
              !row.deletedAt &&
              (actor.role === Role.ADMIN || ordinary || exceptional),
            requiresReason: actor.role === Role.ADMIN || exceptional,
            canReview: actor.role === Role.SUPERVISOR,
            canResolveReplacement: actor.role === Role.ADMIN,
            canFollowMonitor: actor.role !== Role.MONITOR,
            canGrant: actor.role === Role.ADMIN,
          },
        };
      });
      const next =
        rows
          .flatMap((r) => [
            this.editStartsAt(r),
            r.scheduledStart,
            r.scheduledEnd,
            r.editDeadline,
            ...grants
              .filter((g) => g.recordId === r.id)
              .map((g) => g.expiresAt),
          ])
          .filter((d) => d > now)
          .sort((a, b) => +a - +b)[0] ?? null;
      const observed = [
        ...new Set(
          rows
            .flatMap((r) => [
              r.titularMonitorId,
              r.effectiveMonitorId,
              r.monitorCoverage?.monitor_id,
            ])
            .filter((id): id is string => typeof id === 'string'),
        ),
      ];
      const followup =
        actor.role === Role.MONITOR
          ? undefined
          : (
              await tx.$queryRaw<{ data: unknown[]; total: number }[]>`
        WITH notes AS (SELECT * FROM session_monitor_observations WHERE date=${new Date(date)}::date
          AND class_id=${selection.classId}::uuid AND shift_id=${selection.shiftId} AND monitor_id=ANY(${observed}::uuid[]) AND deleted_at IS NULL)
        SELECT (SELECT count(*)::int FROM notes) total,COALESCE((SELECT jsonb_agg(page) FROM (
          SELECT * FROM notes ORDER BY created_at DESC,id DESC LIMIT 25) page),'[]'::jsonb) data`
            )[0];
      return {
        context: {
          accountId: actor.id,
          process: actor.schema,
          role: actor.role,
          serverNow: now.toISOString(),
          timeZone: 'America/Lima',
          operationalDate: new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Lima',
          }).format(now),
        },
        selection: { ...selection, blocks: rows.length },
        options: { classes, courses, shifts },
        rows: projected,
        policy: {
          canFollowMonitor: actor.role !== Role.MONITOR,
          canGrant: actor.role === Role.ADMIN,
          configurationPending: config.alertThresholdMinutes === null,
        },
        summary: {
          pending: rows.filter((r) => this.completeness(r) === 'INCOMPLETE')
            .length,
          nextUpdateAt: next,
        },
        ...(followup
          ? {
              monitorFollowup: {
                observations: followup.data,
                total: followup.total,
                page: 1,
                limit: 25,
              },
            }
          : {}),
      };
    });
  }

  completeness(record: ClassSessionRecord) {
    return record.teachingStatus === 'UNCONFIRMED' ||
      !record.effectiveMonitorId ||
      !record.initialFileId ||
      !record.finalFileId ||
      (record.teachingStatus === 'TAUGHT' &&
        (!record.actualStart ||
          !record.actualEnd ||
          !record.effectiveTeacherId))
      ? 'INCOMPLETE'
      : 'COMPLETE';
  }

  async detail(principal: SessionPrincipal, id: number) {
    const { client, actor } = await this.context(principal);
    const record = await this.authorizeRecord(client, actor, id, false, true);
    const [coverages, reviews, grants] = await Promise.all([
      client.sessionCoverage.findMany({
        where: { recordId: id },
        orderBy: { id: 'asc' },
      }),
      client.sessionReview.findMany({
        where: { recordId: id },
        orderBy: { id: 'desc' },
      }),
      client.sessionEditGrant.findMany({
        where: { recordId: id },
        orderBy: { id: 'desc' },
      }),
    ]);
    return {
      ...record,
      coverages,
      reviews,
      grants,
      ...(actor.role === Role.ADMIN ? { eligibleGrantAccounts: await client.user.findMany({ where: { isActive:true, OR:[...(record.monitorAccountId ? [{ id:record.monitorAccountId, role:String(Role.MONITOR) }] : []), ...(record.supervisorId ? [{ role:String(Role.SUPERVISOR), supervisor:{ id:record.supervisorId } }] : [])] }, select:{ id:true,email:true,role:true } }) } : {}),
      completeness: this.completeness(record),
      reviewStatus:
        reviews[0]?.recordVersion === record.version
          ? reviews[0].result
          : 'PENDING',
    };
  }

  async history(principal: SessionPrincipal, id: number, page = 1) {
    const { client, actor } = await this.context(principal);
    this.admin(actor);
    await this.authorizeRecord(client, actor, id, false, true);
    return client.sessionAuditEvent.findMany({
      where: { recordId: id },
      orderBy: { id: 'desc' },
      skip: (page - 1) * 50,
      take: 50,
    });
  }

  async people(
    principal: SessionPrincipal,
    id: number,
    query: SessionPeopleQueryDto,
  ) {
    const { client, actor } = await this.context(principal);
    return this.transaction(client, actor.schema, async (tx) => {
      const record = await this.authorizeRecord(tx, actor, id, false, true);
      const search = query.search?.trim();
      const user: Prisma.UserWhereInput = {
        isActive: true,
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                {
                  userProfile: {
                    firstName: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  userProfile: {
                    lastName: { contains: search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      };
      const options = {
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { id: 'asc' } as const,
        select: {
          id: true,
          user: {
            select: {
              email: true,
              userProfile: { select: { firstName: true, lastName: true } },
            },
          },
        },
      } as const;
      const [data, total] =
        query.kind === 'TEACHER'
          ? await Promise.all([
              tx.teacher.findMany({
                ...options,
                where: { courseId: record.courseId, user },
              }),
              tx.teacher.count({ where: { courseId: record.courseId, user } }),
            ])
          : await Promise.all([
              tx.monitor.findMany({ ...options, where: { user } }),
              tx.monitor.count({ where: { user } }),
            ]);
      return {
        data: data.map(({ id, user }) => ({
          id,
          name: [user.userProfile?.firstName, user.userProfile?.lastName]
            .filter(Boolean)
            .join(' '),
          email: user.email,
        })),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  /**
   * Aviso persistente del reemplazo. La campana se entera por su consulta/SSE;
   * pg_notify solo señaliza después del commit y no sustituye la fila persistida.
   */
  async notifyCoverage(
    tx: SessionTx,
    schema: string,
    record: ClassSessionRecord,
    coverage: {
      id: number;
      status: string;
      kind: string;
      requestedBy: unknown;
    },
    event: 'PROPOSED' | 'RESOLVED' | 'MONITOR_SUBSTITUTION',
    actor: SessionActor,
  ) {
    const admins = await this.prisma
      .getClientForSchema('core_schema')
      .user.findMany({
        where: { role: String(Role.ADMIN), isActive: true },
        select: { id: true },
      });
    const recipients: { id: string; origin: string }[] = admins.map((a) => ({
      id: a.id,
      origin: 'core_schema',
    }));
    if (record.supervisorId) {
      const supervisor = await tx.supervisor.findUnique({
        where: { id: record.supervisorId },
        include: { users: true },
      });
      if (supervisor?.users.isActive)
        recipients.push({ id: supervisor.userId, origin: schema });
    }
    const requester = coverage.requestedBy as SessionActor | null;
    if (event === 'RESOLVED' && requester?.id)
      recipients.push({ id: requester.id, origin: requester.origin });
    if (event === 'PROPOSED' && coverage.kind === 'TEACHER') {
      const minute = (d: Date) => new Date(+d - 5 * 3600000).getUTCHours() * 60 + new Date(+d - 5 * 3600000).getUTCMinutes();
      const blocks = [{ start: record.scheduledStart.toISOString(), end: record.scheduledEnd.toISOString(), startMinute: minute(record.scheduledStart), endMinute: minute(record.scheduledEnd) }];
      const eligible = await tx.$queryRaw<{ id: string }[]>`SELECT u.id FROM teachers person JOIN users u ON u.id=person.user_id WHERE u.is_active AND u.role='profesor' AND person.id<>${record.titularTeacherId}::uuid ${teacherAvailabilitySql(record.date.toISOString().slice(0,10), blocks, record.courseId, [record.id])}`;
      const coordinators = await tx.$queryRaw<{ id: string }[]>`SELECT u.id FROM users u LEFT JOIN teachers t ON t.user_id=u.id WHERE u.is_active AND (u.role='coordinador' OR u.role=${'coordinador-' + record.courseId} OR (t.is_coordinator AND t.course_id=${record.courseId}))`;
      recipients.push(...[...eligible, ...coordinators].map(({id}) => ({id, origin: schema})));
    }
    const unique = [
      ...new Map(
        recipients
          .filter((r) => !(r.id === actor.id && r.origin === actor.origin))
          .map((r) => [r.id + ':' + r.origin, r]),
      ).values(),
    ];
    if (!unique.length) return [];
    const snapshot = record.snapshot as { course?: string; className?: string };
    const result =
      coverage.status === 'AUTHORIZED'
        ? 'autorizado'
        : coverage.status === 'REJECTED'
          ? 'rechazado'
          : coverage.status === 'REVOKED'
            ? 'revocado'
            : 'pendiente de autorización';
    const title =
      event === 'PROPOSED'
        ? 'Propuesta de reemplazo pendiente'
        : event === 'MONITOR_SUBSTITUTION'
          ? 'Sustitución de monitor registrada'
          : `Reemplazo ${result}`;
    const message =
      event === 'MONITOR_SUBSTITUTION'
        ? `${title}: ${snapshot.course ?? 'Curso'} · ${snapshot.className ?? 'Aula'} · ${record.period}º bloque · ${record.date.toISOString().slice(0, 10)}. No cambia la cuenta ni el aula.`
        : `${title}: ${snapshot.course ?? 'Curso'} · ${snapshot.className ?? 'Aula'} · ${record.period}º bloque · ${record.date.toISOString().slice(0, 10)}. La autorización no confirma el dictado.`;
    const kind =
      event === 'PROPOSED'
        ? 'part.replacement.proposed'
        : event === 'MONITOR_SUBSTITUTION'
          ? 'part.monitor.substitution'
          : 'part.replacement.resolved';
    const dedupe = schema + ':' + (
      event === 'MONITOR_SUBSTITUTION'
        ? `part-monitor:${coverage.id}:substitution`
        : `part-coverage:${coverage.id}:${event.toLowerCase()}:${coverage.status}`);
    await tx.$executeRaw`INSERT INTO public.operation_notifications(recipient_id,recipient_origin,process_schema,kind,title,message,dedupe_key)
      SELECT x.id::uuid,x.origin,${schema},${kind},${title},${message},${dedupe}
      FROM jsonb_to_recordset(${JSON.stringify(unique)}::jsonb) x(id text,origin text)
      ON CONFLICT(recipient_id,recipient_origin,dedupe_key) DO NOTHING`;
    await tx.$executeRaw`SELECT pg_notify('operations_changed',${JSON.stringify({ schema, recipients: unique })})`;
    return unique;
  }

  /** Nota privada: el monitor nunca es destinatario ni recibe su texto. */
  async notifyMonitorNote(
    tx: SessionTx,
    schema: string,
    context: {
      classId: string;
      date: Date;
      shiftId: number;
      monitorId: string;
    },
    noteId: string,
    version: number,
    event: 'CREATED' | 'UPDATED' | 'WITHDRAWN',
    actor: SessionActor,
  ) {
    const admins = await this.prisma
      .getClientForSchema('core_schema')
      .user.findMany({
        where: { role: String(Role.ADMIN), isActive: true },
        select: { id: true },
      });
    const recipients: { id: string; origin: string }[] = admins.map((a) => ({
      id: a.id,
      origin: 'core_schema',
    }));
    const record = await tx.classSessionRecord.findFirst({
      where: {
        classId: context.classId,
        date: context.date,
        shiftId: context.shiftId,
        deletedAt: null,
      },
      select: { supervisorId: true },
    });
    const supervisorId =
      record?.supervisorId ??
      (
        await tx.class.findFirst({
          where: { id: context.classId, monitorId: context.monitorId },
          select: { monitor: { select: { supervisorId: true } } },
        })
      )?.monitor?.supervisorId;
    if (supervisorId) {
      const supervisor = await tx.supervisor.findUnique({
        where: { id: supervisorId },
        include: { users: true },
      });
      if (supervisor?.users.isActive)
        recipients.push({ id: supervisor.userId, origin: schema });
    }
    const unique = [
      ...new Map(
        recipients
          .filter((r) => !(r.id === actor.id && r.origin === actor.origin))
          .map((r) => [r.id + ':' + r.origin, r]),
      ).values(),
    ];
    if (!unique.length) return [];
    const title =
      event === 'CREATED'
        ? 'Nota privada registrada'
        : event === 'UPDATED'
          ? 'Nota privada corregida'
          : 'Nota privada retirada';
    const message = `${title} · ${context.date.toISOString().slice(0, 10)} · turno ${context.shiftId}. No se envía al monitor.`;
    const kind = 'part.monitor.note';
    const dedupe = `${schema}:monitor-note:${noteId}:${event.toLowerCase()}:${version}`;
    await tx.$executeRaw`INSERT INTO public.operation_notifications(recipient_id,recipient_origin,process_schema,kind,title,message,dedupe_key)
      SELECT x.id::uuid,x.origin,${schema},${kind},${title},${message},${dedupe}
      FROM jsonb_to_recordset(${JSON.stringify(unique)}::jsonb) x(id text,origin text)
      ON CONFLICT(recipient_id,recipient_origin,dedupe_key) DO NOTHING`;
    await tx.$executeRaw`SELECT pg_notify('operations_changed',${JSON.stringify({ schema, recipients: unique })})`;
    return unique;
  }

  async notifyRecord(tx: SessionTx, actor: SessionActor, record: ClassSessionRecord, kind: string, stage: string, title: string, includeMonitor: boolean, beneficiary?: string) {
    const admins = await this.prisma.getClientForSchema('core_schema').user.findMany({ where: { role: String(Role.ADMIN), isActive: true }, select: { id: true } });
    const recipients = admins.map(({ id }) => ({ id, origin: 'core_schema' }));
    if (record.supervisorId) {
      const supervisor = await tx.supervisor.findUnique({ where: { id: record.supervisorId }, include: { users: true } });
      if (supervisor?.users.isActive) recipients.push({ id: supervisor.userId, origin: actor.schema });
    }
    for (const id of [includeMonitor ? record.monitorAccountId : null, beneficiary]) {
      if (id && (await tx.user.findUnique({ where: { id }, select: { isActive: true } }))?.isActive) recipients.push({ id, origin: actor.schema });
    }
    const unique = [...new Map(recipients.filter(r => r.id !== actor.id || r.origin !== actor.origin).map(r => [r.origin + ':' + r.id, r])).values()];
    const dedupe = `${actor.schema}:part:${record.id}:${stage}`;
    const message = `${record.date.toISOString().slice(0, 10)} · bloque ${record.period}. Consulta el estado vigente; el aviso no confirma ejecución ni incluye texto privado.`;
    await tx.$executeRaw`INSERT INTO public.operation_notifications(recipient_id,recipient_origin,process_schema,kind,title,message,dedupe_key) SELECT x.id::uuid,x.origin,${actor.schema},${'part.' + kind},${title},${message},${dedupe} FROM jsonb_to_recordset(${JSON.stringify(unique)}::jsonb) x(id text,origin text) ON CONFLICT(recipient_id,recipient_origin,dedupe_key) DO NOTHING`;
    await tx.$executeRaw`SELECT pg_notify('operations_changed',${JSON.stringify({ schema: actor.schema, recipients: unique })})`;
  }

  async person(tx: SessionTx, kind: string, id: string, courseId?: number) {
    if (kind === 'TEACHER') {
      const teacher = await tx.teacher.findUnique({
        where: { id },
        include: { user: { include: { userProfile: true } } },
      });
      if (
        !teacher?.user.isActive ||
        teacher.user.role !== String(Role.TEACHER) ||
        teacher.courseId !== courseId
      )
        throw new BadRequestException(
          'Docente no registrado, inactivo o de otro curso',
        );
      return {
        id: teacher.id,
        userId: teacher.userId,
        email: teacher.user.email,
        name: [
          teacher.user.userProfile?.firstName,
          teacher.user.userProfile?.lastName,
        ]
          .filter(Boolean)
          .join(' '),
      };
    }
    const monitor = await tx.monitor.findUnique({
      where: { id },
      include: { user: { include: { userProfile: true } } },
    });
    if (!monitor?.user.isActive || monitor.user.role !== String(Role.MONITOR))
      throw new BadRequestException('Monitor no registrado o inactivo');
    return {
      id: monitor.id,
      userId: monitor.userId,
      email: monitor.user.email,
      name: [
        monitor.user.userProfile?.firstName,
        monitor.user.userProfile?.lastName,
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  update(
    principal: SessionPrincipal,
    id: number,
    dto: UpdateSessionDto,
    administrative = false,
  ) {
    let observationWarning: string | undefined;
    const email = dto.replacementEmail?.trim().toLowerCase();
    if (
      email &&
      (!dto.operationId ||
        !['RN', 'RE'].includes(dto.classState ?? '') ||
        Object.entries(dto).some(
          ([key, value]) =>
            value !== undefined &&
            ![
              'replacementEmail',
              'operationId',
              'classState',
              'expectedVersion',
              'reason',
            ].includes(key),
        ))
    )
      throw new BadRequestException(
        'La propuesta requiere RN/RE, correo y una operación propia de estado',
      );
    const operation = email
      ? {
          id: dto.operationId!,
          hash: createHash('sha256')
            .update(
              JSON.stringify({
                id,
                expectedVersion: dto.expectedVersion,
                email,
                state: dto.classState,
                reason: dto.reason?.trim() ?? '',
              }),
            )
            .digest('hex'),
        }
      : undefined;
    return this.mutate(
      principal,
      id,
      dto.expectedVersion,
      administrative ? 'ADMIN_CORRECTION' : 'UPDATE',
      dto.reason,
      async (tx, record, actor) => {
        if (email) {
          const candidate = await tx.teacher.findFirst({
            where: {
              user: {
                email: { equals: email, mode: 'insensitive' },
                isActive: true,
                role: String(Role.TEACHER),
              },
              courseId: record.courseId,
            },
          });
          if (!candidate || candidate.id === record.titularTeacherId)
            throw new BadRequestException(
              'El correo no corresponde a un docente reemplazante activo del curso',
            );
          await assertPartTeacherAvailable(tx, record, candidate.id);
          if (
            await tx.sessionCoverage.findFirst({
              where: {
                recordId: id,
                kind: 'TEACHER',
                status: { in: ['PENDING', 'AUTHORIZED'] },
              },
            })
          )
            throw new ConflictException(
              'Ya existe una propuesta o cobertura activa; debe resolverse antes de cambiarla',
            );
          const person = await this.person(
            tx,
            'TEACHER',
            candidate.id,
            record.courseId,
          );
          const coverage = await tx.sessionCoverage.create({
            data: {
              recordId: id,
              kind: 'TEACHER',
              teacherId: candidate.id,
              mode: dto.classState === 'RE' ? 'EMERGENCY' : 'PLANNED',
              status: 'PENDING',
              personSnapshot: json(person),
              operationId: operation!.id,
              proposalHash: operation!.hash,
              requestedBy: json(actor),
              requestedAt: await this.now(tx),
              reason:
                dto.reason?.trim() || 'Propuesta desde el estado del bloque',
            },
          });
          await this.audit(
            tx,
            actor,
            id,
            'COVERAGE_PROPOSED',
            null,
            coverage,
            dto.reason,
          );
          await this.notifyCoverage(
            tx,
            actor.schema,
            record,
            coverage,
            'PROPOSED',
            actor,
          );
          return {};
        }
        if (
          actor.role !== Role.ADMIN &&
          (dto.effectiveTeacherId !== undefined ||
            dto.effectiveMonitorId !== undefined)
        )
          throw new ForbiddenException(
            'Solo administración puede cambiar el docente o monitor del parte',
          );
        const data: Prisma.ClassSessionRecordUncheckedUpdateInput = {};
        const state =
          dto.classState === undefined ? record.classState : dto.classState;
        if (dto.classState !== undefined) data.classState = dto.classState;
        if (dto.teachingStatus !== undefined)
          data.teachingStatus = dto.teachingStatus;
        if (dto.titularOutcome !== undefined)
          data.titularOutcome = dto.titularOutcome;
        if (dto.incidents !== undefined && actor.role === Role.ADMIN)
          data.incidents = dto.incidents;
        if (dto.structuredObservations !== undefined) {
          if (
            new Set(dto.structuredObservations.map((o) => o.id)).size !==
            dto.structuredObservations.length
          )
            throw new BadRequestException('Observaciones duplicadas');
          for (const o of dto.structuredObservations)
            if (
              o.target === 'STUDENT' &&
              (!o.firstName?.trim() || !o.lastName?.trim())
            )
              throw new BadRequestException(
                'Indica nombres y apellidos del alumno',
              );
          if (
            dto.structuredObservations.some(
              (o) => o.description.trim().length < 3,
            )
          )
            throw new BadRequestException(
              'La descripción debe contener al menos tres caracteres',
            );
          data.structuredObservations = json(
            observationMetadata(
              dto.structuredObservations,
              record.structuredObservations,
              actor,
              await this.now(tx),
            ),
          );
          data.incidents = dto.structuredObservations
            .map(
              (o) =>
                `[${o.target}] ${o.target === 'STUDENT' ? o.firstName + ' ' + o.lastName + ': ' : ''}${o.description.trim()}`,
            )
            .join('\n');
        } else if (dto.incidents !== undefined && actor.role !== Role.ADMIN)
          throw new BadRequestException(
            'Clasifica la observación como docente, alumno o aula',
          );
        for (const field of ['actualStart', 'actualEnd'] as const)
          if (dto[field] !== undefined)
            data[field] = dto[field] ? new Date(dto[field]) : null;
        if (state) {
          const started =
            dto.actualStart === undefined
              ? record.actualStart
              : dto.actualStart;
          data.teachingStatus =
            state === 'SD' ? 'NOT_TAUGHT' : started ? 'TAUGHT' : 'UNCONFIRMED';
          data.titularOutcome =
            state === 'SD'
              ? 'ABSENT'
              : state === 'RN'
                ? 'PLANNED_REPLACEMENT'
                : started
                  ? state === 'RE'
                    ? 'ABSENT'
                    : 'PRESENT'
                  : 'UNKNOWN';
          if (state === 'SD') {
            data.actualStart = null;
            data.actualEnd = null;
          }
          if (state === 'RN' || state === 'RE') {
            const authorized = await tx.sessionCoverage.findFirst({
              where: {
                recordId: id,
                kind: 'TEACHER',
                mode: state === 'RE' ? 'EMERGENCY' : 'PLANNED',
                status: 'AUTHORIZED',
              },
            });
            if (!authorized)
              throw new BadRequestException(
                state === 'RE'
                  ? 'Supervisión debe registrar el reemplazo de emergencia'
                  : 'Administración debe registrar el reemplazo normal',
              );
          }
        } else if (dto.classState === null) {
          data.teachingStatus = 'UNCONFIRMED';
          data.titularOutcome = 'UNKNOWN';
        }
        const effectiveSnapshot = {
          ...(record.effectiveSnapshot as Prisma.JsonObject),
        };
        const effectiveIds: Partial<
          Pick<UpdateSessionDto, 'effectiveTeacherId' | 'effectiveMonitorId'>
        > = actor.role === Role.ADMIN ? dto : {};
        if (actor.role === Role.MONITOR || actor.role === Role.SUPERVISOR) {
          if (!record.effectiveMonitorId)
            effectiveIds.effectiveMonitorId =
              (
                await tx.sessionCoverage.findFirst({
                  where: {
                    recordId: id,
                    kind: 'MONITOR',
                    status: 'AUTHORIZED',
                  },
                })
              )?.monitorId ?? record.titularMonitorId;
          const status =
            data.teachingStatus ?? dto.teachingStatus ?? record.teachingStatus;
          const hasStart =
            dto.actualStart === undefined
              ? record.actualStart
              : dto.actualStart;
          if (
            !record.effectiveTeacherId &&
            hasStart &&
            (status === 'TAUGHT' || status === 'INTERRUPTED')
          ) {
            const authorized = await tx.sessionCoverage.findFirst({
              where: { recordId: id, kind: 'TEACHER', status: 'AUTHORIZED' },
              orderBy: { id: 'desc' },
            });
            effectiveIds.effectiveTeacherId =
              authorized?.teacherId ??
              ((data.titularOutcome ??
                dto.titularOutcome ??
                record.titularOutcome) === 'ABSENT'
                ? null
                : record.titularTeacherId);
          }
          if (state === 'SD') effectiveIds.effectiveTeacherId = null;
        }
        for (const [field, kind, titular] of [
          ['effectiveTeacherId', 'TEACHER', record.titularTeacherId],
          ['effectiveMonitorId', 'MONITOR', record.titularMonitorId],
        ] as const) {
          const personId = effectiveIds[field];
          if (personId === undefined) continue;
          if (personId && personId !== titular) {
            const coverage = await tx.sessionCoverage.findFirst({
              where: {
                recordId: id,
                kind,
                status: 'AUTHORIZED',
                ...(kind === 'TEACHER'
                  ? { teacherId: personId }
                  : { monitorId: personId }),
              },
            });
            if (!coverage)
              throw new BadRequestException(
                'Declare una cobertura o solicitud de emergencia antes de registrar al reemplazante',
              );
          }
          data[field] = personId;
          effectiveSnapshot[kind] = personId
            ? await this.person(tx, kind, personId, record.courseId)
            : null;
        }
        data.effectiveSnapshot = json(effectiveSnapshot);
        const start =
          state === 'SD'
            ? null
            : dto.actualStart === undefined
              ? record.actualStart
              : dto.actualStart
                ? new Date(dto.actualStart)
                : null;
        const end =
          state === 'SD'
            ? null
            : dto.actualEnd === undefined
              ? record.actualEnd
              : dto.actualEnd
                ? new Date(dto.actualEnd)
                : null;
        if (start && end && end < start)
          throw new BadRequestException('Intervalo real inválido');
        const now = await this.now(tx);
        if ((start && start > now) || (end && end > now))
          throw new BadRequestException(
            'No se pueden confirmar hechos futuros',
          );
        observationWarning = await syncPartObservations(
          tx,
          actor,
          record,
          dto.structuredObservations === undefined
            ? undefined
            : dto.structuredObservations
                .filter((o) => o.target === 'TEACHER')
                .map((o) => o.description.trim())
                .sort()
                .join('\n'),
          now,
        );
        return data;
      },
      administrative,
      operation,
    ).then((record) =>
      observationWarning ? { ...record, observationWarning } : record,
    );
  }
}
