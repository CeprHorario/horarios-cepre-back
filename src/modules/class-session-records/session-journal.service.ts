import { plusDays, operationalMonday, weekCutoff, findWeekPlan, executionDateFor, assertAdvanceNoConflicts, weekDays } from './session-week';
import { signalNotificationRecipients } from '../operations/notification-signal';
import { applyApprovedReplacements } from '../operations/apply-approved-replacements';
import { assertPartTeacherAvailable } from '../operations/teacher-availability';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  MonitorJournalDto,
  CreateMonitorObservationDto,
  UpdateMonitorObservationDto,
  WithdrawMonitorObservationDto,
  MonitorObservationQueryDto,
} from './session.dto';
import {
  json,
  SessionPrincipal,
  SessionTx,
  SessionActor,
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

  private async monitorJournal(
    tx: SessionTx,
    actor: SessionActor,
    q: MonitorJournalDto,
  ) {
    if (actor.role === Role.MONITOR) this.records.admin(actor);
    const scoped = await this.records.scope(tx, actor);
    const historical = await tx.classSessionRecord.findFirst({
      where: {
        ...scoped,
        date: new Date(q.date),
        classId: q.classId,
        shiftId: q.shiftId,
        deletedAt: null,
        OR: [
          { titularMonitorId: q.monitorId },
          { effectiveMonitorId: q.monitorId },
          {
            coverages: {
              some: {
                kind: 'MONITOR',
                monitorId: q.monitorId,
                status: 'AUTHORIZED',
              },
            },
          },
        ],
      },
    });
    if (!historical) {
      const current = await tx.class.findFirst({
        where: {
          id: q.classId,
          shiftId: q.shiftId,
          monitorId: q.monitorId,
          ...(actor.role === Role.SUPERVISOR
            ? { monitor: { supervisors: { userId: actor.id } } }
            : {}),
        },
      });
      if (!current || q.date !== limaDate(await this.records.now(tx)))
        throw new BadRequestException('Jornada de monitor no disponible');
    }
    return this.records.person(tx, 'MONITOR', q.monitorId);
  }

  async monitorObservations(
    principal: SessionPrincipal,
    q: MonitorObservationQueryDto,
  ) {
    const { client, actor } = await this.records.context(principal);
    return this.records.transaction(client, actor.schema, async (tx) => {
      await this.monitorJournal(tx, actor, q);
      const [result] = await tx.$queryRaw<
        { data: unknown[]; total: number }[]
      >`WITH notes AS (
        SELECT * FROM session_monitor_observations WHERE date=${new Date(q.date)}::date AND class_id=${q.classId}::uuid
        AND shift_id=${q.shiftId} AND monitor_id=${q.monitorId}::uuid AND deleted_at IS NULL
      ) SELECT (SELECT count(*)::int FROM notes) total,COALESCE((SELECT jsonb_agg(page) FROM (
        SELECT * FROM notes ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ${(q.page - 1) * 25}
      ) page),'[]'::jsonb) data`;
      return { ...result, page: q.page, limit: 25 };
    });
  }

  async saveMonitorObservation(
    principal: SessionPrincipal,
    q:
      | CreateMonitorObservationDto
      | UpdateMonitorObservationDto
      | WithdrawMonitorObservationDto,
    id?: string,
    withdraw = false,
  ) {
    const { client, actor } = await this.records.context(principal);
    return this.records.transaction(client, actor.schema, async (tx) => {
      const monitor = await this.monitorJournal(tx, actor, q),
        now = await this.records.now(tx);
      const [before] = id
        ? await tx.$queryRaw<
            { version: number; deleted_at: Date | null }[]
          >`SELECT * FROM session_monitor_observations
        WHERE id=${id}::uuid AND date=${new Date(q.date)}::date AND class_id=${q.classId}::uuid AND shift_id=${q.shiftId}
        AND monitor_id=${q.monitorId}::uuid FOR UPDATE`
        : [];
      if (
        id &&
        (!before ||
          before.deleted_at ||
          !('expectedVersion' in q) ||
          before.version !== q.expectedVersion)
      )
        throw new ConflictException(
          'Nota retirada, ajena o versión desactualizada',
        );
      let after: unknown;
      if (id) {
        if (withdraw) this.records.reason('reason' in q ? q.reason : undefined);
        [after] = withdraw
          ? await tx.$queryRaw`UPDATE session_monitor_observations SET deleted_at=${now},deleted_by=${JSON.stringify(actor)}::jsonb,deletion_reason=${(q as WithdrawMonitorObservationDto).reason},version=version+1,updated_at=${now},updated_by=${JSON.stringify(actor)}::jsonb WHERE id=${id}::uuid RETURNING *`
          : await tx.$queryRaw`UPDATE session_monitor_observations SET text=${(q as UpdateMonitorObservationDto).text.trim()},version=version+1,updated_at=${now},updated_by=${JSON.stringify(actor)}::jsonb WHERE id=${id}::uuid RETURNING *`;
      } else {
        [after] =
          await tx.$queryRaw`INSERT INTO session_monitor_observations(date,class_id,shift_id,monitor_id,monitor_snapshot,text,author,updated_by,created_at,updated_at)
          VALUES(${new Date(q.date)}::date,${q.classId}::uuid,${q.shiftId},${q.monitorId}::uuid,${JSON.stringify(monitor)}::jsonb,${(q as CreateMonitorObservationDto).text.trim()},${JSON.stringify(actor)}::jsonb,${JSON.stringify(actor)}::jsonb,${now},${now}) RETURNING *`;
      }
      await this.records.audit(
        tx,
        actor,
        null,
        withdraw
          ? 'MONITOR_NOTE_WITHDRAWN'
          : id
            ? 'MONITOR_NOTE_UPDATED'
            : 'MONITOR_NOTE_CREATED',
        before,
        after,
        'reason' in q ? q.reason : undefined,
      );
      const saved = after as { id: string; version: number };
      await this.records.notifyMonitorNote(
        tx,
        actor.schema,
        {
          classId: q.classId,
          date: new Date(q.date),
          shiftId: q.shiftId,
          monitorId: q.monitorId,
        },
        saved.id,
        saved.version,
        withdraw ? 'WITHDRAWN' : id ? 'UPDATED' : 'CREATED',
        actor,
      );
      return after;
    });
  }

  async materialize(
    client: PrismaClient,
    schema: string,
    date: string,
    actor = systemActor(schema),
  ) {
    const now = await this.records.transaction(client, schema, tx => this.records.now(tx));
    if (date !== limaDate(now)) throw new BadRequestException('Solo se materializa la jornada actual; no reconstruir historia con horario vigente');
    return this.materializeDate(client, schema, date, actor);
  }

  private async planningInTx(tx: SessionTx) {
    const now=await this.records.now(tx), current=operationalMonday(limaDate(now)), next=plusDays(current,7);
    const [present,future,config,cutoff]=await Promise.all([findWeekPlan(tx,current),findWeekPlan(tx,next),tx.sessionOperationalConfig.findUniqueOrThrow({where:{id:1}}),weekCutoff(tx,next)]);
    const scheduled=await tx.$queryRaw<{weekday:string}[]>`SELECT DISTINCT weekday::text FROM schedules WHERE weekday<>'SUNDAY'`;
    const codes=['','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
    const days=[1,2,3,4,5,6].filter(d=>scheduled.some(s=>s.weekday===codes[d])&&(!config.startsOn||plusDays(next,d-1)>=config.startsOn.toISOString().slice(0,10))&&(!config.endsOn||plusDays(next,d-1)<=config.endsOn.toISOString().slice(0,10))).map(d=>({weekday:d,label:weekDays[d],academicDate:plusDays(next,d-1)}));
    return {current:{from:current,to:plusDays(current,5),generated:Boolean(present?.generated_at),advancedWeekday:present?.advanced_weekday??null,sunday:plusDays(current,-1)},next:{from:next,to:plusDays(next,5),sunday:plusDays(next,-1),cutoff:cutoff.toISOString(),weekday:future?.advanced_weekday??null,version:future?.version??0,generated:Boolean(future?.generated_at),canChoose:Boolean(present?.generated_at)&&!future?.generated_at&&config.enabled&&now<cutoff&&days.length>0,days},serverNow:now.toISOString()};
  }

  async weeklyPlanning(principal: SessionPrincipal) {
    const {client,schema,actor}=await this.records.context(principal);this.records.admin(actor);
    return this.records.transaction(client,schema,tx=>this.planningInTx(tx));
  }

  async chooseWeekAdvance(principal: SessionPrincipal, dto: {weekStart:string;weekday:number|null;expectedVersion:number}) {
    const {client,schema,actor}=await this.records.context(principal);this.records.admin(actor);
    return this.records.transaction(client,schema,async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${schema+':week-plans'},0))::text`;
      const info=await this.planningInTx(tx);
      if(dto.weekStart!==info.next.from)throw new ConflictException('La semana cambió. Actualiza la planificación.');
      if(!info.next.canChoose)throw new ConflictException('El adelanto solo puede decidirse después de generar esta semana y antes del cierre del último turno del sábado');
      if(dto.expectedVersion!==info.next.version)throw new ConflictException('Otra persona modificó esta planificación');
      if(dto.weekday!==null&&!info.next.days.some(d=>d.weekday===dto.weekday))throw new BadRequestException('Selecciona un día programado de la próxima semana');
      const [existing]=await tx.$queryRaw<{id:number}[]>`SELECT id FROM class_session_records WHERE COALESCE(academic_date,date) BETWEEN ${new Date(info.next.from)}::date AND ${new Date(info.next.to)}::date LIMIT 1`;
      if(existing)throw new ConflictException('La próxima semana ya tiene partes. No se pueden trasladar registros existentes.');
      const old=await findWeekPlan(tx,info.next.from);
      const affected=[dto.weekday,old?.advanced_weekday].filter((d):d is number=>d!==null&&d!==undefined).map(d=>plusDays(info.next.from,d-1));
      if(affected.length){
        const [request]=await tx.$queryRaw<{id:string}[]>`SELECT id FROM replacement_requests WHERE status IN ('PENDING','ADMIN_PENDING','CHANGES','APPROVED') AND (date=ANY(${affected}::date[]) OR date=${new Date(info.next.sunday)}::date) LIMIT 1`;
        if(request)throw new ConflictException('Hay solicitudes de reemplazo pendientes o aprobadas en las fechas afectadas. Resuélvelas antes de cambiar la jornada.');
      }
      if(dto.weekday!==null)await assertAdvanceNoConflicts(tx,plusDays(info.next.from,dto.weekday-1),info.next.sunday);
      const [saved]=await tx.$queryRaw<{version:number}[]>`INSERT INTO session_week_plans(week_start,advanced_weekday,updated_by) VALUES(${new Date(info.next.from)}::date,${dto.weekday}::smallint,${JSON.stringify(actor)}::jsonb) ON CONFLICT(week_start) DO UPDATE SET advanced_weekday=EXCLUDED.advanced_weekday,version=session_week_plans.version+1,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp() RETURNING version`;
      await tx.$executeRaw`INSERT INTO session_week_plan_events(week_start,actor,before_value,after_value) VALUES(${new Date(info.next.from)}::date,${JSON.stringify(actor)}::jsonb,${old?JSON.stringify(old):null}::jsonb,${JSON.stringify({weekday:dto.weekday,version:saved.version})}::jsonb)`;
      return this.planningInTx(tx);
    },30000);
  }

  async materializeWeek(client: PrismaClient, schema: string, actor = systemActor(schema), requestedMonday?:string) {
    return this.records.transaction(client,schema,async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${schema+':week-plans'},0))::text`;
      const now=await this.records.now(tx),today=limaDate(now),current=operationalMonday(today),from=requestedMonday??current,to=plusDays(from,5);
      if(from!==current&&(from!==plusDays(current,7)||now<await weekCutoff(tx,from)))throw new BadRequestException('La próxima semana se genera al cerrar el último turno del sábado');
      const plan=await findWeekPlan(tx,from),config=await tx.sessionOperationalConfig.findUniqueOrThrow({where:{id:1}});
      const days:{date:string;executionDate:string;created:number}[]=[];
      if(plan?.generated_at)return {from,to,created:0,alreadyGenerated:true,days};
      if(!config.enabled||!config.startsOn||!config.endsOn||new Date(to)<config.startsOn||new Date(from)>config.endsOn)return {from,to,created:0,alreadyGenerated:false,days};
      if(plan?.advanced_weekday&&plusDays(from,-1)>=today)await assertAdvanceNoConflicts(tx,plusDays(from,plan.advanced_weekday-1),plusDays(from,-1));
      for(let i=0;i<6;i++){
        const date=plusDays(from,i),executionDate=plan?.advanced_weekday===i+1?plusDays(from,-1):date;
        if(executionDate<today){days.push({date,executionDate,created:0});continue;}
        const result=await this.materializeDateInTx(tx,date,actor,executionDate);days.push({date,executionDate,created:result.created});
      }
      await tx.$executeRaw`INSERT INTO session_week_plans(week_start,generated_at,updated_by) VALUES(${new Date(from)}::date,${now},${JSON.stringify(actor)}::jsonb) ON CONFLICT(week_start) DO UPDATE SET generated_at=EXCLUDED.generated_at,updated_at=clock_timestamp()`;
      await tx.$executeRaw`INSERT INTO session_week_plan_events(week_start,actor,after_value) VALUES(${new Date(from)}::date,${JSON.stringify(actor)}::jsonb,${JSON.stringify({action:'GENERATED',days})}::jsonb)`;
      if(plan?.advanced_weekday&&plusDays(from,-1)>=today)await this.notifyWeekAdvance(tx,schema,from,plan.advanced_weekday);
      return {from,to,created:days.reduce((n,d)=>n+d.created,0),alreadyGenerated:false,days};
    },60000);
  }

  async ensureWeeklyGeneration(client:PrismaClient,schema:string) {
    await this.materializeWeek(client,schema);
    const now=await this.records.transaction(client,schema,tx=>this.records.now(tx));
    const next=plusDays(operationalMonday(limaDate(now)),7);
    const cutoff=await this.records.transaction(client,schema,tx=>weekCutoff(tx,next));
    if(now>=cutoff)await this.materializeWeek(client,schema,systemActor(schema),next);
  }

  private async notifyWeekAdvance(tx:SessionTx,schema:string,monday:string,weekday:number) {
    const academic=plusDays(monday,weekday-1),execution=plusDays(monday,-1);
    const admins=await this.records.prisma.getClientForSchema('core_schema').user.findMany({where:{role:String(Role.ADMIN),isActive:true},select:{id:true}});
    const people=await tx.$queryRaw<{id:string;origin:string}[]>`SELECT DISTINCT u.id,${schema} AS origin FROM class_session_records r LEFT JOIN teachers t ON t.id=r.titular_teacher_id LEFT JOIN supervisors s ON s.id=r.supervisor_id JOIN users u ON u.id IN (t.user_id,s.user_id,r.monitor_account_id) WHERE r.academic_date=${new Date(academic)}::date AND u.is_active`;
    const recipients=[...admins.map(a=>({id:a.id,origin:'core_schema'})),...people];if(!recipients.length)return;
    await tx.$executeRaw`INSERT INTO public.operation_notifications(recipient_id,recipient_origin,process_schema,kind,title,message,dedupe_key) SELECT x.id::uuid,x.origin,${schema},'part.week.advance','Jornada adelantada',${'La jornada académica del '+academic+' se dicta el domingo '+execution+'. Se conservan cursos y horas; la edición corresponde al domingo.'},${schema+':advance:'+monday} FROM jsonb_to_recordset(${JSON.stringify(recipients)}::jsonb) x(id text,origin text) ON CONFLICT DO NOTHING`;
    await signalNotificationRecipients(tx,schema,recipients);
  }

  private async materializeDate(client: PrismaClient, schema: string, date: string, actor: SessionActor) {
    return this.records.transaction(client,schema,async tx=>{
      const executionDate=await executionDateFor(tx,date);
      if(executionDate<limaDate(await this.records.now(tx))) return {created:0};
      return this.materializeDateInTx(tx,date,actor,executionDate);
    },60000);
  }

  private async materializeDateInTx(tx: SessionTx, date: string, actor: SessionActor, executionDate=date) {
    const config = await tx.sessionOperationalConfig.findUniqueOrThrow({
      where: { id: 1 },
    });
    const [duration]=await tx.$queryRaw<{breakMinutes:number}[]>`SELECT COALESCE((SELECT break_minutes FROM public.admission_processes WHERE name=current_schema()),5)::int AS "breakMinutes"`;
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
    const lastBlocks = await tx.hourSession.groupBy({
      by: ['shiftId'],
      where: {
        shiftId: { in: [...new Set(schedules.map((s) => s.clas.shiftId))] },
      },
      _max: { endTime: true },
    });
    const shiftEnds = new Map(
      lastBlocks.map((h) => [h.shiftId, h._max.endTime]),
    );
    const pending: Prisma.ClassSessionRecordCreateManyInput[] = [];
    for (const s of schedules) {
      const start = academicInstant(executionDate, s.hourSession.startTime);
      // Complete today's scheduled journal even when enabled after classes started.
      // Execution remains unconfirmed; existing records keep their original snapshots.
      const end = academicInstant(executionDate, s.hourSession.endTime);
      const lastBlockEnd = shiftEnds.get(s.clas.shiftId);
      if (!s.clas.shift.endTime || !lastBlockEnd)
        throw new BadRequestException(
          'Configure fin del turno antes de materializar',
        );
      const shiftEnd = academicInstant(executionDate, lastBlockEnd);
      const data: Prisma.ClassSessionRecordCreateManyInput = {
        date: new Date(executionDate),
        academicDate: executionDate === date ? null : day,
        classId: s.classId,
        hourSessionId: s.hourSessionId,
        shiftId: s.clas.shiftId,
        areaId: s.clas.areaId,
        courseId: s.courseId,
        scheduleId: s.id,
        scheduledStart: start,
        scheduledEnd: end,
        shiftEnd,
        editOpensAt: new Date(
          +start -
            (s.hourSession.period === 1
              ? config.earlyEditMinutes * 60000
              : 0),
        ),
        editDeadline: new Date(+shiftEnd + config.editGraceMinutes * 60000),
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
          breakMinutes: duration.breakMinutes,
          version: config.version,
          latenessToleranceMinutes: config.latenessToleranceMinutes,
          replacementWaitMinutes: config.replacementWaitMinutes,
          alertThresholdMinutes: config.alertThresholdMinutes,
          escalationDelayMinutes: config.escalationDelayMinutes,
          continuityGapMinutes: config.continuityGapMinutes,
        }),
      };
      pending.push(data);
    }
    const inserted = pending.length ? await tx.classSessionRecord.createManyAndReturn({data:pending,skipDuplicates:true}) : [];
    if (inserted.length) await tx.$executeRaw`INSERT INTO session_audit_events(record_id,action,actor,after)
      SELECT (r->>'id')::int,'MATERIALIZED',${JSON.stringify(actor)}::jsonb,r FROM jsonb_array_elements(${JSON.stringify(inserted)}::jsonb) r`;
    await applyApprovedReplacements(tx);
    return { created: inserted.length };
  }

  async agenda(principal: SessionPrincipal, date: string) {
    const { client, schema, actor } = await this.records.context(principal);
    const now = await this.records.transaction(client, schema, (tx) =>
      this.records.now(tx),
    );
    if (date === limaDate(now))
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
      const lastBlock = await tx.hourSession.aggregate({
        where: { shiftId: clas.shiftId },
        _max: { endTime: true },
      });
      const policy = await tx.sessionOperationalConfig.findUniqueOrThrow({
        where: { id: 1 },
      });
      const start = academicInstant(dto.date, hour.startTime),
        end = academicInstant(dto.date, hour.endTime),
        shiftEnd = academicInstant(
          dto.date,
          lastBlock._max.endTime ?? clas.shift.endTime,
        );
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
          editOpensAt: new Date(
            +start - (hour.period === 1 ? policy.earlyEditMinutes * 60000 : 0),
          ),
          editDeadline: new Date(+shiftEnd + policy.editGraceMinutes * 60000),
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
    if (actor.role !== Role.ADMIN && !(actor.role===Role.SUPERVISOR&&dto.mode==='EMERGENCY'))
      throw new ForbiddenException(
        'Supervisión registra emergencias; el permiso normal requiere aprobación administrativa',
      );
    if(dto.sameTurn&&(dto.sameTurnReason?.trim().length??0)<10)throw new BadRequestException('Justifica que no encontraste reemplazante de otro turno');
    if (new Set(dto.targets.map((t) => t.recordId)).size !== dto.targets.length)
      throw new BadRequestException('Bloques repetidos');
    return this.records.transaction(
      client,
      actor.schema,
      async (tx) => {
        const operationId = dto.operationId ?? (await tx.$queryRaw<{id:string}[]>`SELECT uuidv7()::text AS id`)[0].id;
        const targets = [...dto.targets].sort((a,b) => a.recordId-b.recordId);
        const hash = createHash('sha256').update(JSON.stringify({ targets, kind:dto.kind, personId:dto.personId, mode:dto.mode, reason:dto.reason.trim(), actor })).digest('hex');
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.schema + ':coverage:' + operationId},0))::text`;
        const previous = await tx.sessionCoverage.findMany({ where: { operationId }, orderBy: { recordId: 'asc' } });
        if (previous.length) {
          if (previous.length !== targets.length || previous.some(item => item.proposalHash !== hash)) throw new ConflictException('Operación ya utilizada para otra intención');
          for (const item of previous) await this.records.authorizeRecord(tx, actor, item.recordId);
          return { operationId, data: previous };
        }
        for (const target of targets) await this.records.lock(tx, target.recordId);
        if(dto.mode==='EMERGENCY'){
          const work=await tx.classSessionRecord.findMany({where:{id:{in:targets.map(t=>t.recordId)}},orderBy:{period:'asc'}});
          if(work.some((r,i)=>r.classId!==work[0].classId||r.shiftId!==work[0].shiftId||+r.date!==+work[0].date||(dto.kind==='TEACHER'&&r.courseId!==work[0].courseId)||(i>0&&r.period!==work[i-1].period+1)))throw new BadRequestException('Selecciona solo bloques consecutivos de la misma clase');
        }
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
            false,
          );
          this.records.version(r, target.expectedVersion);
          if(dto.mode==='EMERGENCY'){
            const now=await this.records.now(tx);
            if(limaDate(now)!==r.date.toISOString().slice(0,10)||now>=r.editDeadline)throw new ForbiddenException('La emergencia solo se registra en la jornada vigente antes de su cierre');
            if(dto.kind==='TEACHER'&&(r.actualStart||r.actualEnd))throw new ConflictException('El bloque ya tiene horas registradas; requiere una corrección administrativa');
          }
          if(dto.kind==='MONITOR'){
            const [origin,candidate]=await Promise.all([tx.class.findUniqueOrThrow({where:{id:r.classId}}),tx.monitor.findUnique({where:{id:dto.personId},include:{classes:true}})]);
            if(!candidate?.classes||candidate.classes.areaId!==origin.areaId)throw new BadRequestException('El monitor reemplazante debe pertenecer a la misma área');
          }
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
            dto.sameTurn??false,
          );
          if (dto.kind === 'TEACHER')
            await assertPartTeacherAvailable(tx, r, dto.personId);
          const now = await this.records.now(tx);
          if (actor.role === Role.SUPERVISOR && dto.mode!=='EMERGENCY')
            await this.records.assertWritable(tx, actor, r, dto.reason);
          const coverage = await tx.sessionCoverage.create({
            data: {
              recordId: r.id,
              kind: dto.kind,
              teacherId: dto.kind === 'TEACHER' ? person.id : null,
              monitorId: dto.kind === 'MONITOR' ? person.id : null,
              mode: dto.mode,
              status: 'AUTHORIZED',
              personSnapshot: json(person),
              operationId,
              proposalHash: hash,
              requestedBy: json(actor),
              requestedAt: now,
              reason:dto.reason+(dto.sameTurn?' · No se encontró reemplazante de otro turno: '+dto.sameTurnReason:''),
              resolvedBy: json(actor),
              resolvedAt: now,
            },
          });
          // Coverage never overwrites execution, outcomes, Schedule or scheduledHours.
          await tx.classSessionRecord.update({
            where: { id: r.id, version: r.version },
            data: {
              version: { increment: 1 },
              ...(dto.kind==='TEACHER'?{
                classState:dto.mode==='EMERGENCY'?'RE':'RN', effectiveTeacherId:person.id,
                effectiveSnapshot:json({...r.effectiveSnapshot as Prisma.JsonObject,TEACHER:person}),
                ...(dto.mode==='EMERGENCY'?{actualStart:r.scheduledStart,actualEnd:r.scheduledEnd,teachingStatus:'TAUGHT',titularOutcome:'ABSENT'}:{}),
              }:{effectiveMonitorId:person.id,effectiveSnapshot:json({...r.effectiveSnapshot as Prisma.JsonObject,MONITOR:person})}),
            },
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
          if (dto.kind === 'MONITOR')
            await this.records.notifyCoverage(
              tx,
              actor.schema,
              r,
              coverage,
              'MONITOR_SUBSTITUTION',
              actor,
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
    sameTurn=false,
  ) {
    if(kind==='MONITOR'){
      const other=await tx.$queryRaw<{id:number}[]>`SELECT c.id FROM session_coverages c JOIN class_session_records rec ON rec.id=c.record_id JOIN class_session_records target ON target.id=${recordId} WHERE c.kind='MONITOR' AND c.monitor_id=${personId}::uuid AND c.status='AUTHORIZED' AND rec.date=${date}::date AND rec.class_id<>target.class_id LIMIT 1`;
      if(other.length)throw new ConflictException('El monitor ya cubre otro salón en esta jornada');
      const performed=await tx.$queryRaw<{id:number}[]>`SELECT rec.id FROM class_session_records rec JOIN class_session_records target ON target.id=${recordId} WHERE rec.effective_monitor_id=${personId}::uuid AND rec.titular_monitor_id IS DISTINCT FROM ${personId}::uuid AND rec.date=${date}::date AND rec.class_id<>target.class_id AND (rec.actual_start IS NOT NULL OR rec.actual_end IS NOT NULL) LIMIT 1`;
      if(performed.length)throw new ConflictException('El monitor ya realizó un reemplazo en otro salón durante esta jornada');
    }
    const conflict = await tx.sessionCoverage.findFirst({
      where: {
        recordId: { not: recordId },
        kind,
        status: 'AUTHORIZED',
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
    const titular = kind==='MONITOR'&&sameTurn?null:await tx.classSessionRecord.findFirst({
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
    const monitorWork =
      kind === 'MONITOR'
        ? await tx.$queryRaw<{ conflict: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM schedules s JOIN classes c ON c.id=s.class_id JOIN hour_sessions h ON h.id=s.hour_session_id
        WHERE NOT ${sameTurn} AND c.monitor_id=${personId}::uuid AND s.weekday::text=${['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][date.getUTCDay()]}
        AND h.start_time<(${end}::timestamptz AT TIME ZONE 'America/Lima')::time
        AND h.end_time>(${start}::timestamptz AT TIME ZONE 'America/Lima')::time)
      OR EXISTS(SELECT 1 FROM replacement_requests req JOIN monitors m ON m.user_id=req.replacement_user_id
        CROSS JOIN jsonb_array_elements(req.blocks) b WHERE m.id=${personId}::uuid AND req.date=${date}::date AND req.status='APPROVED'
        AND (b->>'start')::timestamptz<${end} AND (b->>'end')::timestamptz>${start}) AS conflict`
        : [];
    if (conflict || titular || monitorWork[0]?.conflict)
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
      if (dto.status === 'AUTHORIZED') {
        await this.records.person(
          tx,
          coverage.kind,
          coverage.teacherId ?? coverage.monitorId!,
          r.courseId,
        );
        if (coverage.kind === 'TEACHER')
          await assertPartTeacherAvailable(tx, r, coverage.teacherId!);
        else
          await tx.$queryRaw`SELECT id FROM monitors WHERE id=${coverage.monitorId}::uuid FOR UPDATE`;
        await this.coverageConflict(
          tx,
          r.id,
          r.scheduledStart,
          r.scheduledEnd,
          coverage.kind,
          coverage.teacherId ?? coverage.monitorId!,
          r.date,
        );
      }
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
        data: {
          version: { increment: 1 },
          ...(dto.status === 'AUTHORIZED' && coverage.kind === 'TEACHER'
            ? {classState:coverage.mode==='EMERGENCY'?'RE':'RN',effectiveTeacherId:coverage.teacherId,
                effectiveSnapshot:json({...r.effectiveSnapshot as Prisma.JsonObject,TEACHER:coverage.personSnapshot}),
                ...(coverage.mode==='EMERGENCY'?{actualStart:r.scheduledStart,actualEnd:r.scheduledEnd,teachingStatus:'TAUGHT',titularOutcome:'ABSENT'}:{})}
            : {}),
        },
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
      await this.records.notifyCoverage(
        tx,
        actor.schema,
        r,
        updated,
        'RESOLVED',
        actor,
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
        !(
          (account.role === String(Role.MONITOR) &&
            r.monitorAccountId === account.id) ||
          (account.role === String(Role.SUPERVISOR) &&
            r.supervisorId !== null &&
            !!(await tx.supervisor.findFirst({
              where: { userId: account.id, id: r.supervisorId },
            })))
        )
      )
        throw new BadRequestException(
          'La habilitación requiere la cuenta monitor o un supervisor activo del recurso',
        );
      if (new Date(dto.expiresAt) <= (await this.records.now(tx)))
        throw new BadRequestException('Vencimiento inválido');
      const grant = await tx.sessionEditGrant.create({
        data: {
          recordId: id,
          accountId: account.id,
          expiresAt: new Date(dto.expiresAt),
          createdAt: await this.records.now(tx),
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
      await this.records.notifyRecord(tx, actor, r, 'edit.granted', `grant:${grant.id}:created`, 'Edición excepcional habilitada', false, account.id);
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
      await this.records.notifyRecord(tx, actor, r, 'edit.revoked', `grant:${grant.id}:revoked`, 'Habilitación excepcional revocada', false, grant.accountId);
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
