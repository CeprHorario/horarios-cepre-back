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
  UpdateSessionDto,
} from './session.dto';

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
    if (write) {
      if (actor.role === Role.SUPERVISOR)
        throw new ForbiddenException(
          'El supervisor revisa, no modifica el parte',
        );
      await this.assertWritable(tx, actor, record);
    }
    return record;
  }

  async now(tx: SessionTx): Promise<Date> {
    const [row] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    return row.now;
  }

  async assertWritable(
    tx: SessionTx,
    actor: SessionActor,
    record: ClassSessionRecord,
  ) {
    await tx.$queryRaw`SELECT set_config('cepr.session_account',${actor.id},true)`;
    const now = await this.now(tx);
    if (record.deletedAt) throw new ForbiddenException('Parte anulado');
    if (now < record.scheduledStart)
      throw new ForbiddenException('El bloque todavía no comienza');
    if (now < record.editDeadline) return;
    const grant = await tx.sessionEditGrant.findFirst({
      where: {
        recordId: record.id,
        accountId: actor.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (!grant)
      throw new ForbiddenException(
        'Plazo cerrado; requiere habilitación o corrección administrativa motivada',
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
    return tx.sessionAuditEvent.create({
      data: {
        recordId,
        action,
        actor: json(actor),
        before: before == null ? Prisma.DbNull : json(before),
        after: after == null ? Prisma.DbNull : json(after),
        reason,
      },
    });
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
  ) {
    const { client, actor } = await this.context(principal);
    return this.transaction(client, actor.schema, async (tx) => {
      await this.lock(tx, id);
      const record = await this.authorizeRecord(
        tx,
        actor,
        id,
        !administrative,
        administrative,
      );
      if (administrative) {
        this.admin(actor);
        this.reason(reason);
      }
      if (administrative)
        await tx.$queryRaw`SELECT set_config('cepr.session_override','true',true)`;
      this.version(record, expected);
      const data = await change(tx, record, actor);
      // Recheck after validations/uploads: the original deadline is never moved.
      if (!administrative) await this.assertWritable(tx, actor, record);
      const updated = await tx.classSessionRecord.update({
        where: { id, version: expected },
        data: { ...data, version: { increment: 1 } },
      });
      await this.audit(tx, actor, id, action, record, updated, reason);
      return updated;
    });
  }

  reason(reason?: string): asserts reason is string {
    if (!reason || reason.trim().length < 3)
      throw new BadRequestException('Se requiere un motivo');
  }

  range(query: SessionQueryDto) {
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
      completeness: this.completeness(record),
      reviewStatus:
        reviews[0]?.recordVersion === record.version
          ? reviews[0].result
          : 'PENDING',
    };
  }

  async history(principal: SessionPrincipal, id: number, page = 1) {
    const { client, actor } = await this.context(principal);
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

  async person(tx: SessionTx, kind: string, id: string, courseId?: number) {
    if (kind === 'TEACHER') {
      const teacher = await tx.teacher.findUnique({
        where: { id },
        include: { user: { include: { userProfile: true } } },
      });
      if (!teacher?.user.isActive || teacher.courseId !== courseId)
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
    if (!monitor?.user.isActive)
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
    return this.mutate(
      principal,
      id,
      dto.expectedVersion,
      administrative ? 'ADMIN_CORRECTION' : 'UPDATE',
      dto.reason,
      async (tx, record) => {
        const data: Prisma.ClassSessionRecordUncheckedUpdateInput = {};
        if (dto.teachingStatus !== undefined)
          data.teachingStatus = dto.teachingStatus;
        if (dto.titularOutcome !== undefined)
          data.titularOutcome = dto.titularOutcome;
        if (dto.incidents !== undefined) data.incidents = dto.incidents;
        for (const field of ['actualStart', 'actualEnd'] as const)
          if (dto[field] !== undefined)
            data[field] = dto[field] ? new Date(dto[field]) : null;
        const effectiveSnapshot = {
          ...(record.effectiveSnapshot as Prisma.JsonObject),
        };
        for (const [field, kind, titular] of [
          ['effectiveTeacherId', 'TEACHER', record.titularTeacherId],
          ['effectiveMonitorId', 'MONITOR', record.titularMonitorId],
        ] as const) {
          const personId = dto[field];
          if (personId === undefined) continue;
          if (personId && personId !== titular) {
            const coverage = await tx.sessionCoverage.findFirst({
              where: {
                recordId: id,
                kind,
                status: { in: ['AUTHORIZED', 'PENDING'] },
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
          dto.actualStart === undefined
            ? record.actualStart
            : dto.actualStart
              ? new Date(dto.actualStart)
              : null;
        const end =
          dto.actualEnd === undefined
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
        return data;
      },
      administrative,
    );
  }
}
