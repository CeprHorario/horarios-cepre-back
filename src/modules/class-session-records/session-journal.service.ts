import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { ClassSessionRecordsService } from './class-session-records.service';
import {
  CoverageDto,
  GrantDto,
  OperationalConfigDto,
  ReasonDto,
  RecoveryDto,
  ResolveCoverageDto,
  ReviewDto,
} from './session.dto';
import {
  json,
  SessionPrincipal,
  SessionTx,
  systemActor,
} from './session.types';

export function limaDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function academicInstant(date: string, time: Date): Date {
  return new Date(`${date}T${time.toISOString().slice(11, 23)}-05:00`);
}

@Injectable()
export class SessionJournalService {
  constructor(private readonly records: ClassSessionRecordsService) {}

  async materialize(
    client: PrismaClient,
    schema: string,
    date: string,
    actor = systemActor(schema),
  ) {
    if (date !== limaDate())
      throw new BadRequestException(
        'Solo se materializa la jornada actual; no reconstruir historia con horario vigente',
      );
    return this.records.transaction(
      client,
      schema,
      async (tx) => {
        const config = await tx.sessionOperationalConfig.findUniqueOrThrow({
          where: { id: 1 },
        });
        const day = new Date(date);
        if (
          !config.enabled ||
          !config.startsOn ||
          !config.endsOn ||
          day < config.startsOn ||
          day > config.endsOn
        )
          return { created: 0 };
        const weekday = [
          'Domingo',
          'Lunes',
          'Martes',
          'Miercoles',
          'Jueves',
          'Viernes',
          'Sabado',
        ][day.getUTCDay()] as Prisma.EnumWeekdayFilter['equals'];
        const schedules = await tx.schedule.findMany({
          where: { weekday },
          include: {
            clas: {
              include: {
                monitor: {
                  include: { user: { include: { userProfile: true } } },
                },
                area: true,
                shift: true,
              },
            },
            teacher: { include: { user: { include: { userProfile: true } } } },
            course: true,
            hourSession: true,
          },
        });
        let created = 0;
        for (const s of schedules) {
          const start = academicInstant(date, s.hourSession.startTime);
          // Never invent a past expected block after startup/configuration/schedule changes.
          if (start < (await this.records.now(tx))) continue;
          const end = academicInstant(date, s.hourSession.endTime);
          if (!s.clas.shift.endTime)
            throw new BadRequestException(
              'Configure fin del turno antes de materializar',
            );
          const shiftEnd = academicInstant(date, s.clas.shift.endTime);
          const data: Prisma.ClassSessionRecordCreateManyInput = {
            date: day,
            classId: s.classId,
            hourSessionId: s.hourSessionId,
            shiftId: s.clas.shiftId,
            areaId: s.clas.areaId,
            courseId: s.courseId,
            scheduleId: s.id,
            scheduledStart: start,
            scheduledEnd: end,
            shiftEnd,
            editDeadline: new Date(+shiftEnd + 90 * 60000),
            period: s.hourSession.period,
            pedagogicalMinutes: s.hourSession.durationMinutes,
            titularTeacherId: s.teacherId,
            titularMonitorId: s.clas.monitorId,
            monitorAccountId: s.clas.monitor?.userId,
            supervisorId: s.clas.monitor?.supervisorId,
            snapshot: json({
              className: s.clas.name,
              area: s.clas.area.name,
              shift: s.clas.shift.name,
              course: s.course.name,
              teacher: s.teacher
                ? {
                    id: s.teacher.id,
                    email: s.teacher.user.email,
                    name: [
                      s.teacher.user.userProfile?.firstName,
                      s.teacher.user.userProfile?.lastName,
                    ]
                      .filter(Boolean)
                      .join(' '),
                  }
                : null,
              monitor: s.clas.monitor
                ? {
                    id: s.clas.monitor.id,
                    email: s.clas.monitor.user.email,
                    name: [
                      s.clas.monitor.user.userProfile?.firstName,
                      s.clas.monitor.user.userProfile?.lastName,
                    ]
                      .filter(Boolean)
                      .join(' '),
                  }
                : null,
            }),
            timingPolicy: json({
              version: config.version,
              latenessToleranceMinutes: config.latenessToleranceMinutes,
              replacementWaitMinutes: config.replacementWaitMinutes,
              alertThresholdMinutes: config.alertThresholdMinutes,
              continuityGapMinutes: config.continuityGapMinutes,
            }),
          };
          const inserted = await tx.classSessionRecord.createMany({
            data,
            skipDuplicates: true,
          });
          if (inserted.count) {
            const record = await tx.classSessionRecord.findUniqueOrThrow({
              where: {
                date_classId_hourSessionId: {
                  date: day,
                  classId: s.classId,
                  hourSessionId: s.hourSessionId,
                },
              },
            });
            await this.records.audit(
              tx,
              actor,
              record.id,
              'MATERIALIZED',
              null,
              record,
            );
            created++;
          }
        }
        return { created };
      },
      30000,
    );
  }

  async agenda(principal: SessionPrincipal, date: string) {
    const { client, schema, actor } = await this.records.context(principal);
    if (date === limaDate())
      await this.materialize(client, schema, date, actor);
    return this.records.list(principal, {
      from: date,
      to: date,
      page: 1,
      limit: 100,
    });
  }

  async recovery(principal: SessionPrincipal, dto: RecoveryDto) {
    this.records.reason(dto.reason);
    const { client, actor } = await this.records.context(principal);
    this.records.admin(actor);
    return this.records.transaction(client, actor.schema, async (tx) => {
      const original = await this.records.authorizeRecord(
        tx,
        actor,
        dto.originalRecordId,
      );
      const clas = await tx.class.findUniqueOrThrow({
        where: { id: dto.classId },
        include: { monitor: true, shift: true, area: true },
      });
      const hour = await tx.hourSession.findUniqueOrThrow({
        where: { id: dto.hourSessionId },
      });
      if (hour.shiftId !== clas.shiftId || !clas.shift.endTime)
        throw new BadRequestException('Bloque/turno incompatible');
      const start = academicInstant(dto.date, hour.startTime),
        end = academicInstant(dto.date, hour.endTime),
        shiftEnd = academicInstant(dto.date, clas.shift.endTime);
      if (start <= (await this.records.now(tx)))
        throw new BadRequestException(
          'La recuperación debe programarse antes de su inicio',
        );
      const record = await tx.classSessionRecord.create({
        data: {
          date: new Date(dto.date),
          classId: clas.id,
          hourSessionId: hour.id,
          shiftId: clas.shiftId,
          areaId: clas.areaId,
          courseId: original.courseId,
          origin: 'RECOVERY',
          originalRecordId: original.id,
          scheduledStart: start,
          scheduledEnd: end,
          shiftEnd,
          editDeadline: new Date(+shiftEnd + 90 * 60000),
          period: hour.period,
          pedagogicalMinutes: hour.durationMinutes,
          titularTeacherId: original.titularTeacherId,
          titularMonitorId: clas.monitorId,
          monitorAccountId: clas.monitor?.userId,
          supervisorId: clas.monitor?.supervisorId,
          snapshot: json({
            ...(original.snapshot as Prisma.JsonObject),
            className: clas.name,
            area: clas.area.name,
            shift: clas.shift.name,
            monitor: clas.monitorId
              ? await this.records.person(tx, 'MONITOR', clas.monitorId)
              : null,
          }),
          timingPolicy: json(original.timingPolicy),
        },
      });
      await this.records.audit(
        tx,
        actor,
        record.id,
        'RECOVERY_CREATED',
        null,
        record,
        dto.reason,
      );
      return record;
    });
  }

  cancel(
    principal: SessionPrincipal,
    id: number,
    dto: ReasonDto,
    restore = false,
  ) {
    return this.records.mutate(
      principal,
      id,
      dto.expectedVersion,
      restore ? 'RESTORED' : 'CANCELLED',
      dto.reason,
      async (tx, r, actor) => {
        if (restore ? !r.deletedAt : !!r.deletedAt)
          throw new ConflictException('Estado de anulación incompatible');
        return restore
          ? { deletedAt: null, deletedBy: Prisma.DbNull, deletionReason: null }
          : {
              deletedAt: await this.records.now(tx),
              deletedBy: json(actor),
              deletionReason: dto.reason,
            };
      },
      true,
    );
  }

  async cover(principal: SessionPrincipal, dto: CoverageDto) {
    this.records.reason(dto.reason);
    const { client, actor } = await this.records.context(principal);
    if (actor.role !== Role.MONITOR) this.records.admin(actor);
    if (actor.role === Role.MONITOR && dto.mode !== 'EMERGENCY')
      throw new BadRequestException('Monitor solo solicita emergencias');
    if (new Set(dto.targets.map((t) => t.recordId)).size !== dto.targets.length)
      throw new BadRequestException('Bloques repetidos');
    return this.records.transaction(
      client,
      actor.schema,
      async (tx) => {
        const [{ id: operationId }] = await tx.$queryRaw<
          { id: string }[]
        >`SELECT uuidv7()::text AS id`;
        const result: unknown[] = [];
        // Global order prevents deadlocks for overlapping bulk operations.
        for (const target of [...dto.targets].sort(
          (a, b) => a.recordId - b.recordId,
        )) {
          await this.records.lock(tx, target.recordId);
          const r = await this.records.authorizeRecord(
            tx,
            actor,
            target.recordId,
            actor.role === Role.MONITOR,
          );
          this.records.version(r, target.expectedVersion);
          const person = await this.records.person(
            tx,
            dto.kind,
            dto.personId,
            r.courseId,
          );
          if (
            dto.personId ===
            (dto.kind === 'TEACHER' ? r.titularTeacherId : r.titularMonitorId)
          )
            throw new BadRequestException('El titular no es reemplazante');
          const active = await tx.sessionCoverage.findFirst({
            where: {
              recordId: r.id,
              kind: dto.kind,
              status: { in: ['PENDING', 'AUTHORIZED'] },
            },
          });
          if (active)
            throw new ConflictException(
              'Existe cobertura activa; resuélvala o revóquela',
            );
          // Cross-room conflicts serialize on the registered replacement person.
          if (dto.kind === 'TEACHER')
            await tx.$queryRaw`SELECT id FROM teachers WHERE id=${dto.personId}::uuid FOR UPDATE`;
          else
            await tx.$queryRaw`SELECT id FROM monitors WHERE id=${dto.personId}::uuid FOR UPDATE`;
          await this.coverageConflict(
            tx,
            r.id,
            r.scheduledStart,
            r.scheduledEnd,
            dto.kind,
            dto.personId,
            r.date,
          );
          const now = await this.records.now(tx);
          if (actor.role === Role.MONITOR)
            await this.records.assertWritable(tx, actor, r);
          const coverage = await tx.sessionCoverage.create({
            data: {
              recordId: r.id,
              kind: dto.kind,
              teacherId: dto.kind === 'TEACHER' ? person.id : null,
              monitorId: dto.kind === 'MONITOR' ? person.id : null,
              mode: dto.mode,
              status: actor.role === Role.ADMIN ? 'AUTHORIZED' : 'PENDING',
              personSnapshot: json(person),
              operationId,
              requestedBy: json(actor),
              reason: dto.reason,
              ...(actor.role === Role.ADMIN
                ? { resolvedBy: json(actor), resolvedAt: now }
                : {}),
            },
          });
          // Coverage never overwrites execution, outcomes, Schedule or scheduledHours.
          await tx.classSessionRecord.update({
            where: { id: r.id, version: r.version },
            data: { version: { increment: 1 } },
          });
          await this.records.audit(
            tx,
            actor,
            r.id,
            'COVERAGE_REQUESTED',
            r,
            { coverage, recordVersion: r.version + 1, operationId },
            dto.reason,
          );
          result.push(coverage);
        }
        return { operationId, data: result };
      },
      15000,
    );
  }

  async coverageConflict(
    tx: SessionTx,
    recordId: number,
    start: Date,
    end: Date,
    kind: string,
    personId: string,
    date: Date,
  ) {
    const conflict = await tx.sessionCoverage.findFirst({
      where: {
        recordId: { not: recordId },
        kind,
        status: { in: ['PENDING', 'AUTHORIZED'] },
        ...(kind === 'TEACHER'
          ? { teacherId: personId }
          : { monitorId: personId }),
        record: {
          date,
          deletedAt: null,
          scheduledStart: { lt: end },
          scheduledEnd: { gt: start },
        },
      },
    });
    const titular = await tx.classSessionRecord.findFirst({
      where: {
        date,
        id: { not: recordId },
        deletedAt: null,
        scheduledStart: { lt: end },
        scheduledEnd: { gt: start },
        OR:
          kind === 'TEACHER'
            ? [{ titularTeacherId: personId }, { effectiveTeacherId: personId }]
            : [
                { titularMonitorId: personId },
                { effectiveMonitorId: personId },
              ],
      },
    });
    if (conflict || titular)
      throw new ConflictException('La persona tiene un bloque superpuesto');
  }

  async resolve(
    principal: SessionPrincipal,
    id: number,
    dto: ResolveCoverageDto,
  ) {
    this.records.reason(dto.reason);
    const { client, actor } = await this.records.context(principal);
    this.records.admin(actor);
    return this.records.transaction(client, actor.schema, async (tx) => {
      const found = await tx.sessionCoverage.findUniqueOrThrow({
        where: { id },
      });
      await this.records.lock(tx, found.recordId);
      const r = await this.records.authorizeRecord(tx, actor, found.recordId);
      this.records.version(r, dto.expectedVersion);
      const coverage = await tx.sessionCoverage.findUniqueOrThrow({
        where: { id },
      });
      if (
        (dto.status === 'REVOKED' && coverage.status !== 'AUTHORIZED') ||
        (dto.status !== 'REVOKED' && coverage.status !== 'PENDING')
      )
        throw new ConflictException('Transición de autorización inválida');
      const updated = await tx.sessionCoverage.update({
        where: { id },
        data: {
          status: dto.status,
          resolvedBy: json(actor),
          resolvedAt: await this.records.now(tx),
        },
      });
      await tx.classSessionRecord.update({
        where: { id: r.id, version: r.version },
        data: { version: { increment: 1 } },
      });
      await this.records.audit(
        tx,
        actor,
        r.id,
        'COVERAGE_RESOLVED',
        coverage,
        updated,
        dto.reason,
      );
      return updated;
    });
  }

  async grant(principal: SessionPrincipal, id: number, dto: GrantDto) {
    this.records.reason(dto.reason);
    const { client, actor } = await this.records.context(principal);
    this.records.admin(actor);
    return this.records.transaction(client, actor.schema, async (tx) => {
      await this.records.lock(tx, id);
      const r = await this.records.authorizeRecord(tx, actor, id);
      this.records.version(r, dto.expectedVersion);
      const account = await tx.user.findUnique({
        where: { id: dto.accountId },
      });
      if (
        !account?.isActive ||
        (account.role as Role) !== Role.MONITOR ||
        r.monitorAccountId !== account.id
      )
        throw new BadRequestException(
          'La habilitación corresponde a la cuenta monitor del parte',
        );
      if (new Date(dto.expiresAt) <= (await this.records.now(tx)))
        throw new BadRequestException('Vencimiento inválido');
      const grant = await tx.sessionEditGrant.create({
        data: {
          recordId: id,
          accountId: account.id,
          expiresAt: new Date(dto.expiresAt),
          reason: dto.reason,
          grantedBy: json(actor),
        },
      });
      await this.records.audit(
        tx,
        actor,
        id,
        'EDIT_GRANTED',
        null,
        grant,
        dto.reason,
      );
      return grant;
    });
  }

  async revokeGrant(principal: SessionPrincipal, id: number, dto: ReasonDto) {
    this.records.reason(dto.reason);
    const { client, actor } = await this.records.context(principal);
    this.records.admin(actor);
    return this.records.transaction(client, actor.schema, async (tx) => {
      const found = await tx.sessionEditGrant.findUniqueOrThrow({
        where: { id },
      });
      await this.records.lock(tx, found.recordId);
      const r = await this.records.authorizeRecord(tx, actor, found.recordId);
      this.records.version(r, dto.expectedVersion);
      const grant = await tx.sessionEditGrant.findUniqueOrThrow({
        where: { id },
      });
      if (grant.revokedAt) throw new ConflictException('Habilitación revocada');
      const updated = await tx.sessionEditGrant.update({
        where: { id },
        data: { revokedAt: await this.records.now(tx), revokedBy: json(actor) },
      });
      await this.records.audit(
        tx,
        actor,
        r.id,
        'EDIT_REVOKED',
        grant,
        updated,
        dto.reason,
      );
      return updated;
    });
  }

  async review(principal: SessionPrincipal, id: number, dto: ReviewDto) {
    const { client, actor } = await this.records.context(principal);
    if (actor.role !== Role.SUPERVISOR)
      throw new BadRequestException(
        'La revisión corresponde al supervisor titular',
      );
    if (dto.confirmed !== true)
      throw new BadRequestException('Confirme explícitamente la revisión');
    return this.records.transaction(client, actor.schema, async (tx) => {
      await this.records.lock(tx, id);
      const r = await this.records.authorizeRecord(tx, actor, id);
      this.records.version(r, dto.expectedVersion);
      const files = await tx.file.findMany({
        where: {
          id: {
            in: [r.initialFileId, r.finalFileId].filter(
              (v): v is string => !!v,
            ),
          },
          status: 'AVAILABLE',
        },
      });
      const review = await tx.sessionReview.create({
        data: {
          recordId: id,
          recordVersion: r.version,
          supervisorId: r.supervisorId!,
          result: dto.result,
          comments: dto.comments,
          files: json(
            files.map((f) => ({
              id: f.id,
              generation: f.generation,
              checksum: f.checksum,
            })),
          ),
          actor: json(actor),
        },
      });
      await this.records.audit(
        tx,
        actor,
        id,
        'REVIEW_CONFIRMED',
        null,
        review,
        dto.reason,
      );
      return review;
    });
  }

  async configuration(principal: SessionPrincipal, dto?: OperationalConfigDto) {
    const { client, actor } = await this.records.context(principal);
    this.records.admin(actor);
    if (!dto)
      return client.sessionOperationalConfig.findUniqueOrThrow({
        where: { id: 1 },
      });
    this.records.reason(dto.reason);
    return this.records.transaction(client, actor.schema, async (tx) => {
      await tx.$queryRaw`SELECT id FROM session_operational_config WHERE id=1 FOR UPDATE`;
      const old = await tx.sessionOperationalConfig.findUniqueOrThrow({
        where: { id: 1 },
      });
      const starts =
        dto.startsOn === undefined
          ? old.startsOn
          : dto.startsOn
            ? new Date(dto.startsOn)
            : null;
      const ends =
        dto.endsOn === undefined
          ? old.endsOn
          : dto.endsOn
            ? new Date(dto.endsOn)
            : null;
      if (
        (starts && ends && ends < starts) ||
        (dto.enabled && (!starts || !ends))
      )
        throw new BadRequestException(
          'Configure un intervalo operativo válido',
        );
      if (old.version !== dto.expectedVersion)
        throw new ConflictException('Configuración desactualizada');
      const { expectedVersion, reason, startsOn, endsOn, ...rest } = dto;
      const data = {
        ...rest,
        ...(startsOn !== undefined
          ? { startsOn: startsOn ? new Date(startsOn) : null }
          : {}),
        ...(endsOn !== undefined
          ? { endsOn: endsOn ? new Date(endsOn) : null }
          : {}),
      };
      const updated = await tx.sessionOperationalConfig.update({
        where: { id: 1, version: expectedVersion },
        data: { ...data, version: { increment: 1 }, updatedBy: json(actor) },
      });
      await this.records.audit(
        tx,
        actor,
        null,
        'CONFIG_UPDATED',
        old,
        updated,
        reason,
      );
      return updated;
    });
  }
}
