import { coverageWork } from './coverage-work';
import { describeEvidence } from './request-evidence';
import type { LetterData } from './request-letter';
import { requestPeople } from './request-person';
import { replacementDecision } from './replacement-workflow';
import { availabilityWeekday, findWeekPlan, operationalMonday, weekDays } from '../class-session-records/session-week';
import { getCoordinatorCourseId } from '../auth/utils/coordinator-role';
import { signalNotificationRecipients } from './notification-signal';
import { applyApprovedReplacements } from './apply-approved-replacements';
import { teacherAvailabilitySql } from './teacher-availability';
import { isDeepStrictEqual } from 'node:util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { Client } from 'pg';
import { parseCoordinatorRole } from '../auth/utils/coordinator-role';
import { Prisma, type Weekday } from '../../generated/prisma/client';
import { Role } from '../auth/decorators/authorization.decorator';
import {
  SessionPrincipal,
  SessionTx,
} from '../class-session-records/session.types';
import { ClassSessionRecordsService } from '../class-session-records/class-session-records.service';
import { academicInstant } from '../class-session-records/session-journal.service';
import { OperationsContext } from './operations-context.service';
import { RequestDocuments } from './request-document.service';
import {
  OperationPageDto,
  ReplacementCandidateDto,
  ReplacementDraftDto,
  RequestContextDto,
  RequestDecisionDto,
  TeachingReplacementQueryDto,
} from './operations.dto';
import { Subject } from 'rxjs';
import { randomUUID, createHash } from 'node:crypto';

export interface WorkBlock {
  hourSessionId: number;
  period: number;
  classId: string | null;
  className: string;
  courseId: number | null;
  course: string;
  shiftId: number;
  start: string;
  end: string;
  startMinute: number;
  endMinute: number;
}
interface Work {
  subjectRole: 'profesor' | 'monitor' | 'supervisor' | 'coordinador';
  subjectUserId: string | null;
  classId: string | null;
  courseId: number | null;
  shiftId: number | null;
  supervisorId: string | null;
  sameTurn?: boolean;
  coverageOperationId?:string;
  recordIds?:number[];
  fullCoverage?:boolean;
  replacementUserId?:string;
  areaId?: number|null;
  candidateShiftId?: number;
  blocks: WorkBlock[];
}
export interface ReplacementRequest {
  coverage_operation_id?:string|null;
  approver_coordinator_id: string | null;
  cancellation_stage: 'REVIEW' | 'ADMIN' | 'CHANGES' | null;
  cancellation_reason: string | null;
  revises_id: string | null;
  same_turn_reason: string;
  document_data: {label:string;value:string}[];
  docx_object: string | null;
  docx_generation: string | null;
  docx_sha256: string | null;
  id: string;
  requester_user_id: string;
  requester_role: string;
  subject_user_id: string | null;
  subject_role: Work['subjectRole'];
  kind: 'NORMAL' | 'EMERGENCY';
  replacement_user_id: string;
  class_id: string | null;
  course_id: number | null;
  date: Date;
  starts_at: Date;
  ends_at: Date;
  blocks: WorkBlock[];
  reason: string;
  status: string;
  version: number;
  approver_supervisor_id: string | null;
  payload_sha256: string | null;
  pdf_object: string;
  pdf_generation: string;
  pdf_sha256: string;
  pdf_size: number;
  evidence_count: number;
  created_at: Date;
  operation_id: string;
  decision_reason: string | null;
  decided_at: Date | null;
}
type Context = Awaited<ReturnType<OperationsContext['get']>>;
@Injectable()
export class OperationsService implements OnModuleInit, OnModuleDestroy {
  private listener?: Client;
  private reconnect?: ReturnType<typeof setTimeout>;
  private stopped = false;
  listening = false;
  private readonly logger = new Logger(OperationsService.name);
  listenerReady: Promise<void> = Promise.resolve();
  readonly changes = new Subject<{
    recipientId: string;
    origin: string;
    schema: string;
    recordId?: number;
    version?: number;
    resync?: boolean;
    transportDown?: boolean;
  }>();
  constructor(
    readonly contexts: OperationsContext,
    private readonly records: ClassSessionRecordsService,
    private readonly documents: RequestDocuments,
  ) {}
  async onModuleInit() {
    this.listenerReady = this.listen();
    await this.listenerReady;
  }
  async onModuleDestroy() {
    this.stopped = true;
    this.listening = false;
    clearTimeout(this.reconnect);
    const listener = this.listener;
    this.listener = undefined;
    await listener?.end().catch(() => undefined);
    this.changes.complete();
  }
  private async listen() {
    if (this.stopped) return;
    const listener = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'cepr-notifications-listener', connectionTimeoutMillis: 5000 });
    this.listener = listener;
    const reconnect = () => {
      if (this.listener !== listener || this.stopped) return;
      this.listener = undefined;
      this.listening = false;
      this.changes.next({schema:'*',recipientId:'*',origin:'',resync:true,transportDown:true});
      void listener.end().catch(() => undefined);
      // ponytail: one dedicated listener per instance; durable rows plus resync replace replay.
      this.reconnect = setTimeout(() => { this.listenerReady = this.listen(); }, 2000);
      this.reconnect.unref();
    };
    listener.on('error', reconnect);
    listener.on('end', reconnect);
    listener.on('notification', (event) => {
      if (!event.payload) return;
      try {
        const signal = JSON.parse(event.payload) as { schema?: string; recipients?: { id: string; origin: string }[]; recordId?: number; version?: number };
        if (typeof signal.schema !== 'string') return;
        for (const recipient of signal.recipients ?? [{ id: '*', origin: '' }])
          this.changes.next({ schema: signal.schema, recipientId: recipient.id, origin: recipient.origin, recordId: signal.recordId, version: signal.version });
      } catch { this.logger.warn('Se ignoró una señal de notificaciones inválida'); }
    });
    try {
      await listener.connect();
      await listener.query('LISTEN operations_changed');
      this.listening = true;
      this.changes.next({ schema: '*', recipientId: '*', origin: '', resync: true });
    } catch {
      this.logger.warn('Listener no disponible; se reintentará sin perder avisos persistidos');
      reconnect();
    }
  }
  private tx<T>(ctx: Context, work: (tx: SessionTx) => Promise<T>) {
    return this.records.transaction(ctx.client, ctx.schema, work, 20000);
  }
  async context(principal: SessionPrincipal) {
    const ctx = await this.contexts.get(principal);
    const config = await ctx.client.sessionOperationalConfig.findUniqueOrThrow({
      where: { id: 1 },
    });
    const [profile]=await this.tx(ctx,tx=>requestPeople(tx,[ctx.user.id]));
    const shifts=await ctx.client.shift.findMany({select:{id:true,name:true},orderBy:{id:'asc'}});
    return {
      profile, shifts,
      accountId: ctx.user.id,
      process: ctx.schema,
      role: getCoordinatorCourseId(ctx.user.role) ? Role.COORDINATOR : ctx.user.role,
      serverNow: new Date().toISOString(),
      name:
        [ctx.user.userProfile?.firstName, ctx.user.userProfile?.lastName]
          .filter(Boolean)
          .join(' ') || ctx.user.email,
      dni: ctx.user.userProfile?.dni ?? null,
      earlyEditMinutes: config.earlyEditMinutes,
      editGraceMinutes: config.editGraceMinutes,
    };
  }
  async classes(principal: SessionPrincipal, q: OperationPageDto) {
    const ctx = await this.contexts.get(principal);
    const scope: Prisma.ClassWhereInput =
      ctx.actor.role === Role.ADMIN
        ? {}
        : ctx.actor.role === Role.MONITOR
          ? { monitor: { userId: ctx.user.id } }
          : ctx.actor.role === Role.SUPERVISOR
            ? { monitor: { supervisors: { userId: ctx.user.id } } }
            : getCoordinatorCourseId(ctx.user.role) ? { schedules: { some: { courseId: getCoordinatorCourseId(ctx.user.role) } } } : { schedules: { some: { teacher: { userId: ctx.user.id } } } };
    const where = {
      ...scope,
      ...(q.search
        ? { name: { contains: q.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [data, total] = await Promise.all([
      ctx.client.class.findMany({
        where,
        select: { id: true, name: true, shiftId: true },
        orderBy: { name: 'asc' },
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      ctx.client.class.count({ where }),
    ]);
    return { data, total, page: q.page, limit: q.limit };
  }
  private async work(
    tx: SessionTx,
    ctx: Context,
    q: RequestContextDto,
    hours?: number[],
  ): Promise<Work> {
    if(q.coverageOperationId)return coverageWork(tx,ctx,q,hours);
    const process = (
      await tx.$queryRaw<
        { started: Date; finished: Date }[]
      >`SELECT started,finished FROM public.admission_processes WHERE name=${ctx.schema}`
    )[0];
    const day = new Date(q.date);
    if (!process || day < process.started || day > process.finished)
      throw new BadRequestException('La fecha no pertenece al proceso');
    const role = ctx.actor.role,
      emergency = q.kind === 'EMERGENCY';
    if (
      ![Role.ADMIN, Role.TEACHER, Role.MONITOR, Role.SUPERVISOR].includes(role) && !getCoordinatorCourseId(ctx.user.role)
    )
      throw new ForbiddenException('Rol sin solicitudes de reemplazo');
    if (
      emergency &&
      !([Role.MONITOR, Role.SUPERVISOR, Role.ADMIN] as Role[]).includes(role)
    )
      throw new ForbiddenException(
        'La emergencia de aula se emite desde monitoreo o supervisión',
      );
    if (!emergency && role === Role.ADMIN)
      throw new ForbiddenException(
        'Administración resuelve las solicitudes del personal',
      );
    const monitor =
      role === Role.MONITOR
        ? await tx.monitor.findUnique({
            where: { userId: ctx.user.id },
            include: { classes: true },
          })
        : null;
    const supervisor =
      role === Role.SUPERVISOR
        ? await tx.supervisor.findUnique({ where: { userId: ctx.user.id } })
        : null;
    const teacher =
      role === Role.TEACHER
        ? await tx.teacher.findUnique({ where: { userId: ctx.user.id } })
        : null;
    let classId = q.classId ?? monitor?.classes?.id ?? null;
    if (
      (role === Role.MONITOR && !monitor) ||
      (role === Role.SUPERVISOR && !supervisor) ||
      (role === Role.TEACHER && !teacher)
    )
      throw new ForbiddenException('Perfil laboral no registrado');
    if (emergency && !classId)
      return {
        subjectRole: 'profesor',
        subjectUserId: null,
        classId: null,
        courseId: null,
        shiftId: null,
        supervisorId: supervisor?.id ?? monitor?.supervisorId ?? null,
        blocks: [],
      };
    if (role === Role.MONITOR && classId !== monitor?.classes?.id)
      throw new ForbiddenException('El aula no pertenece al monitor');
    const classroom = classId
      ? await tx.class.findUnique({
          where: { id: classId },
          include: { monitor: true, shift: true },
        })
      : null;
    if (classId && !classroom)
      throw new NotFoundException('Aula no encontrada');
    if (
      emergency &&
      role === Role.SUPERVISOR &&
      classroom?.monitor?.supervisorId !== supervisor?.id
    )
      throw new ForbiddenException('Aula fuera de supervisión');
    const weekday = [
      'Domingo',
      'Lunes',
      'Martes',
      'Miercoles',
      'Jueves',
      'Viernes',
      'Sabado',
    ][day.getUTCDay()] as Weekday;
    const selectedWeek=await findWeekPlan(tx,operationalMonday(q.date));
    const executionWeekday=day.getUTCDay();
    const movedAway=executionWeekday!==0&&selectedWeek?.advanced_weekday===executionWeekday;
    const dutyDays: Weekday[]=[weekday];
    if(executionWeekday===0&&selectedWeek?.advanced_weekday)dutyDays.push(weekDays[selectedWeek.advanced_weekday] as Weekday);
    const schedules =
      ((role === Role.SUPERVISOR && !emergency) || movedAway)
        ? []
        : await tx.schedule.findMany({
            where: {
              weekday: {in:dutyDays},
              ...(classId ? { classId } : {}),
              ...(teacher ? { teacherId: teacher.id } : {}),
              ...(getCoordinatorCourseId(ctx.user.role) ? {courseId:getCoordinatorCourseId(ctx.user.role)} : {}),
            },
            include: {
              hourSession: true,
              clas: true,
              course: true,
              teacher: true,
            },
            orderBy: { hourSession: { startTime: 'asc' } },
          });
    const duties =
      supervisor && !emergency && !movedAway
        ? await tx.hourSession.findMany({
            where: {
              ...(supervisor.shiftId
                ? { shiftId: supervisor.shiftId }
                : { shift: { classes: { some: { monitor: { supervisorId: supervisor.id } } } } }),
            },
            orderBy: { startTime: 'asc' },
          })
        : [];
    const toMinutes = (t: Date) => t.getUTCHours() * 60 + t.getUTCMinutes();
    let blocks: WorkBlock[] = schedules.map((s) => ({
      hourSessionId: s.hourSessionId,
      period: s.hourSession.period,
      classId: s.classId,
      className: s.clas.name,
      courseId: s.courseId,
      course: s.course.name,
      shiftId: s.hourSession.shiftId,
      start: academicInstant(q.date, s.hourSession.startTime).toISOString(),
      end: academicInstant(q.date, s.hourSession.endTime).toISOString(),
      startMinute: toMinutes(s.hourSession.startTime),
      endMinute: toMinutes(s.hourSession.endTime),
    }));
    if (duties.length)
      blocks = duties.map((h) => ({
        hourSessionId: h.id,
        period: h.period,
        classId: null,
        className: 'Supervisión',
        courseId: null,
        course: 'Supervisión',
        shiftId: h.shiftId,
        start: academicInstant(q.date, h.startTime).toISOString(),
        end: academicInstant(q.date, h.endTime).toISOString(),
        startMinute: toMinutes(h.startTime),
        endMinute: toMinutes(h.endTime),
      }));
    if (hours) {
      blocks = blocks.filter((b) => hours.includes(b.hourSessionId));
      if (blocks.length !== hours.length)
        throw new BadRequestException('Hay bloques ajenos o inexistentes');
      if (!blocks.length)
        throw new BadRequestException('Selecciona bloques de trabajo');
      blocks.sort((a, b) => a.startMinute - b.startMinute);
      if (
        blocks.some(
          (b, i) =>
            i > 0 &&
            (b.shiftId !== blocks[0].shiftId ||
              b.classId !== blocks[0].classId ||
              b.period !== blocks[i - 1].period + 1),
        )
      )
        throw new BadRequestException(
          'Agrupa bloques consecutivos del mismo turno y aula',
        );
      if (
        (teacher || emergency) &&
        blocks.some((b) => b.courseId !== blocks[0].courseId)
      )
        throw new BadRequestException(
          'El reemplazo docente debe corresponder a un mismo curso',
        );
      classId = blocks[0].classId;
    }
    const original =
      emergency && blocks.length
        ? schedules.find((s) => s.hourSessionId === blocks[0].hourSessionId)
            ?.teacher
        : null;
    return {
      subjectRole:
        emergency || teacher ? 'profesor' : monitor ? 'monitor' : getCoordinatorCourseId(ctx.user.role) ? 'coordinador' : 'supervisor',
      subjectUserId: emergency ? (original?.userId ?? null) : ctx.user.id,
      classId,
      courseId:
        teacher?.courseId ?? getCoordinatorCourseId(ctx.user.role) ?? (emergency ? (blocks[0]?.courseId ?? null) : null),
      shiftId: blocks[0]?.shiftId ?? classroom?.shiftId ?? null,
      supervisorId:
        classroom?.monitor?.supervisorId ??
        monitor?.supervisorId ??
        supervisor?.id ??
        null,
      blocks,
      sameTurn:q.sameTurn ?? false,
      areaId:classroom?.areaId??null, candidateShiftId:q.candidateShiftId,
    };
  }
  async options(principal: SessionPrincipal, q: RequestContextDto) {
    const ctx = await this.contexts.get(principal);
    return this.tx(ctx, async (tx) => {
      const w = await this.work(tx, ctx, q);
      const [profile]=await requestPeople(tx,[ctx.user.id]);
      return { subjectRole: w.subjectRole, blocks: w.blocks, profile, classId:w.classId };
    });
  }
  async pendingDocuments(principal:SessionPrincipal){
    const ctx=await this.contexts.get(principal);
    return this.tx(ctx,tx=>tx.$queryRaw`SELECT cv.operation_id AS "operationId",rec.date,min(rec.class_id::text) AS "classId",min(cl.name) AS classroom,cv.kind,cv.mode,array_agg(rec.hour_session_id ORDER BY rec.period) AS hours,
      min(COALESCE(ct.user_id,cm.user_id)::text) AS "replacementUserId"
      FROM session_coverages cv JOIN class_session_records rec ON rec.id=cv.record_id JOIN classes cl ON cl.id=rec.class_id
      LEFT JOIN teachers t ON t.id=rec.titular_teacher_id LEFT JOIN monitors m ON m.id=rec.titular_monitor_id
      LEFT JOIN teachers ct ON ct.id=cv.teacher_id LEFT JOIN monitors cm ON cm.id=cv.monitor_id
      WHERE cv.status IN ('PENDING','AUTHORIZED') AND cv.operation_id IS NOT NULL AND
      ((cv.kind='TEACHER' AND t.user_id=${ctx.user.id}::uuid) OR (cv.kind='MONITOR' AND m.user_id=${ctx.user.id}::uuid))
      AND NOT EXISTS(SELECT 1 FROM session_coverage_document_links link WHERE link.operation_id=cv.operation_id)
      AND NOT EXISTS(SELECT 1 FROM replacement_requests rr WHERE rr.id=cv.operation_id)
      GROUP BY cv.operation_id,rec.date,cv.kind,cv.mode ORDER BY rec.date DESC LIMIT 100`);
  }
  async teachingReplacements(principal:SessionPrincipal,q:TeachingReplacementQueryDto) {
    const ctx=await this.contexts.get(principal);
    if(ctx.actor.role!==Role.TEACHER)throw new ForbiddenException('Solo el docente consulta sus coberturas');
    this.records.range(q);
    return this.tx(ctx,async tx=>{
      const [data,total]=await Promise.all([
        tx.$queryRaw`SELECT r.id,r.date,r.blocks,c.url_meet AS meet,c.url_classroom AS classroom FROM replacement_requests r JOIN classes c ON c.id=r.class_id WHERE r.status='APPROVED' AND r.subject_role='profesor' AND r.replacement_user_id=${ctx.user.id}::uuid AND r.date BETWEEN ${new Date(q.from)}::date AND ${new Date(q.to)}::date ORDER BY r.date,r.starts_at,r.id LIMIT ${q.limit} OFFSET ${(q.page-1)*q.limit}`,
        tx.$queryRaw<{total:number}[]>`SELECT count(*)::int total FROM replacement_requests r WHERE r.status='APPROVED' AND r.subject_role='profesor' AND r.replacement_user_id=${ctx.user.id}::uuid AND r.date BETWEEN ${new Date(q.from)}::date AND ${new Date(q.to)}::date`,
      ]);return {data,total:total[0].total,page:q.page,limit:q.limit};
    });
  }
  private candidateSql(
    work: Work,
    ctx: Context,
    date: string,
    search?: string,
    id?: string,
  ) {
    if(work.coverageOperationId)return Prisma.sql`FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=${work.replacementUserId}::uuid AND u.is_active`;
    const json = JSON.stringify(work.blocks);
    const name = Prisma.sql`COALESCE(NULLIF(BTRIM(concat_ws(' ',p.first_name,p.last_name)),''),u.email)`;
    const specific =
      work.subjectRole === 'profesor'
        ? Prisma.sql`JOIN teachers person ON person.user_id=u.id`
        : work.subjectRole === 'monitor'
          ? Prisma.sql`JOIN monitors person ON person.user_id=u.id JOIN classes owned ON owned.monitor_id=person.id`
          : work.subjectRole==='coordinador' ? Prisma.empty : Prisma.sql`JOIN supervisors person ON person.user_id=u.id`;
    const conflicts =
      work.subjectRole === 'profesor'
        ? teacherAvailabilitySql(date, work.blocks, work.courseId)
        : work.subjectRole === 'monitor'
          ? Prisma.sql`${work.sameTurn ? Prisma.empty : Prisma.sql`AND owned.shift_id<>${work.shiftId}`} AND owned.area_id=${work.areaId}
      AND (${work.sameTurn ?? false} OR NOT EXISTS(SELECT 1 FROM schedules s JOIN hour_sessions h ON h.id=s.hour_session_id CROSS JOIN jsonb_array_elements(${json}::jsonb) b WHERE s.class_id=owned.id AND s.weekday::text IN (${['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][new Date(date).getUTCDay()]},${availabilityWeekday(date)}) AND (EXTRACT(HOUR FROM h.start_time)*60+EXTRACT(MINUTE FROM h.start_time))<(b->>'endMinute')::int AND (EXTRACT(HOUR FROM h.end_time)*60+EXTRACT(MINUTE FROM h.end_time))>(b->>'startMinute')::int))
      AND NOT EXISTS(SELECT 1 FROM replacement_requests one WHERE one.status='APPROVED' AND one.subject_role='monitor' AND one.date=${new Date(date)}::date AND one.replacement_user_id=u.id AND one.class_id IS DISTINCT FROM ${work.classId}::uuid)
      AND NOT EXISTS(SELECT 1 FROM session_coverages cv JOIN class_session_records rec ON rec.id=cv.record_id WHERE cv.kind='MONITOR' AND cv.monitor_id=person.id AND cv.status='AUTHORIZED' AND rec.date=${new Date(date)}::date AND rec.class_id IS DISTINCT FROM ${work.classId}::uuid)
      AND NOT EXISTS(SELECT 1 FROM class_session_records rec WHERE rec.effective_monitor_id=person.id AND rec.titular_monitor_id IS DISTINCT FROM person.id AND rec.date=${new Date(date)}::date AND rec.class_id IS DISTINCT FROM ${work.classId}::uuid AND (rec.actual_start IS NOT NULL OR rec.actual_end IS NOT NULL))`
          : work.subjectRole==='supervisor'&&!work.sameTurn ? Prisma.sql`AND (person.shift_id IS NULL OR person.shift_id<>${work.shiftId}) AND NOT EXISTS(SELECT 1 FROM monitors sm JOIN classes sc ON sc.monitor_id=sm.id WHERE sm.supervisor_id=person.id AND sc.shift_id=${work.shiftId})` : Prisma.empty;
    return Prisma.sql`FROM users u ${specific} LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.is_active AND ${work.subjectRole==='coordinador' ? Prisma.sql`u.role ~ '^coordinador-[0-9]+$'` : Prisma.sql`u.role=${work.subjectRole}`} AND u.id<>${ctx.user.id}::uuid ${work.subjectUserId ? Prisma.sql`AND u.id<>${work.subjectUserId}::uuid` : Prisma.empty} ${id ? Prisma.sql`AND u.id=${id}::uuid` : Prisma.empty} ${search ? Prisma.sql`AND (${name} ILIKE ${'%' + search + '%'} OR u.email ILIKE ${'%' + search + '%'})` : Prisma.empty} ${conflicts} ${work.candidateShiftId ? (work.subjectRole==='monitor' ? Prisma.sql`AND owned.shift_id=${work.candidateShiftId}` : work.subjectRole==='supervisor' ? Prisma.sql`AND (person.shift_id=${work.candidateShiftId} OR EXISTS(SELECT 1 FROM monitors fm JOIN classes fc ON fc.monitor_id=fm.id WHERE fm.supervisor_id=person.id AND fc.shift_id=${work.candidateShiftId}))` : work.subjectRole==='coordinador'?Prisma.empty:Prisma.sql`AND EXISTS(SELECT 1 FROM teacher_availabilities fa JOIN shifts fs ON fs.id=${work.candidateShiftId} WHERE fa.teacher_id=person.id AND fa.weekday::text=${availabilityWeekday(date)} AND fa.start_minute<EXTRACT(HOUR FROM fs.end_time)*60+EXTRACT(MINUTE FROM fs.end_time) AND fa.end_minute>EXTRACT(HOUR FROM fs.start_time)*60+EXTRACT(MINUTE FROM fs.start_time))`) : Prisma.empty}
      AND NOT EXISTS(SELECT 1 FROM session_coverages c JOIN class_session_records rec ON rec.id=c.record_id LEFT JOIN teachers covered_teacher ON covered_teacher.id=c.teacher_id LEFT JOIN monitors covered_monitor ON covered_monitor.id=c.monitor_id CROSS JOIN jsonb_array_elements(${json}::jsonb) b WHERE c.status='AUTHORIZED' AND rec.deleted_at IS NULL AND (covered_teacher.user_id=u.id OR covered_monitor.user_id=u.id) AND rec.scheduled_start<(b->>'end')::timestamptz AND rec.scheduled_end>(b->>'start')::timestamptz)
      AND NOT EXISTS(SELECT 1 FROM replacement_requests r CROSS JOIN jsonb_array_elements(r.blocks) rb CROSS JOIN jsonb_array_elements(${json}::jsonb) b WHERE r.status='APPROVED' AND r.replacement_user_id=u.id AND r.date=${new Date(date)}::date AND (rb->>'start')::timestamptz<(b->>'end')::timestamptz AND (rb->>'end')::timestamptz>(b->>'start')::timestamptz)`;
  }
  async candidates(principal: SessionPrincipal, q: ReplacementCandidateDto) {
    const ctx = await this.contexts.get(principal);
    const hours = q.hours?.split(',').map(Number);
    if (
      !hours?.length ||
      hours.length > 50 ||
      new Set(hours).size !== hours.length
    )
      throw new BadRequestException('Selecciona hasta 50 bloques únicos');
    return this.tx(ctx, async (tx) => {
      const w = await this.work(tx, ctx, q, hours),
        where = this.candidateSql(w, ctx, q.date, q.search);
      const [data, total] = await Promise.all([
        tx.$queryRaw<
          { id: string; name: string; email: string; dni: string | null }[]
        >`SELECT u.id,COALESCE(NULLIF(BTRIM(concat_ws(' ',p.first_name,p.last_name)),''),u.email) AS name,u.email,p.dni ${where} ORDER BY u.email LIMIT 20 OFFSET ${(q.page - 1) * 20}`,
        tx.$queryRaw<{ total: number }[]>`SELECT count(*)::int total ${where}`,
      ]);
      const people=await requestPeople(tx,data.map(p=>p.id));
      return { data:data.map(p=>({...p,...people.find(person=>person.id===p.id)})), total: total[0].total, page: q.page, limit: 20 };
    });
  }
  private async notify(
    tx: SessionTx,
    ctx: Context,
    recipients: { id: string; origin: string }[],
    kind: string,
    title: string,
    message: string,
    requestId: string,
    event: string,
  ) {
    const unique = [
      ...new Map(recipients.map((r) => [r.id + ':' + r.origin, r])).values(),
    ];
    if (!unique.length) return [];
    await tx.$executeRaw`INSERT INTO public.operation_notifications(recipient_id,recipient_origin,process_schema,kind,title,message,request_id,dedupe_key) SELECT x.id::uuid,x.origin,${ctx.schema},${kind},${title},${message},${requestId}::uuid,${ctx.schema + ':' + requestId + ':' + event} FROM jsonb_to_recordset(${JSON.stringify(unique)}::jsonb) x(id text,origin text) ON CONFLICT(recipient_id,recipient_origin,dedupe_key) DO NOTHING`;
    await signalNotificationRecipients(tx, ctx.schema, unique);
    return unique;
  }
  private async approvers(tx: SessionTx, ctx: Context, w: Work) {
    const admins = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM core_schema.users WHERE role='administrador' AND is_active`;
    const list = admins.map((a) => ({ id: a.id, origin: 'core_schema' }));
    if (
      (w.supervisorId && w.subjectRole === 'monitor') ||
      (w.supervisorId &&
        w.subjectRole === 'profesor' &&
        ctx.actor.role === Role.MONITOR)
    ) {
      const s = await tx.supervisor.findUnique({
        where: { id: w.supervisorId },
        include: { users: true },
      });
      if (s?.users.isActive) list.push({ id: s.userId, origin: ctx.schema });
    }
    if(w.subjectRole==='profesor' && w.courseId){const coordinator=await tx.user.findMany({where:{role:'coordinador-'+w.courseId,isActive:true},select:{id:true}});list.push(...coordinator.map(c=>({id:c.id,origin:ctx.schema})));}
    if(w.subjectRole==='monitor'||(w.subjectRole==='profesor'&&ctx.actor.role===Role.MONITOR))return list.filter(p=>p.origin!=='core_schema');
    return list;
  }
  private async reviewerId(tx:SessionTx,r:ReplacementRequest) {
    if(r.subject_role==='profesor'&&r.kind!=='EMERGENCY')return r.approver_coordinator_id;
    if(r.subject_role==='monitor'||r.kind==='EMERGENCY')return (await tx.supervisor.findUnique({where:{id:r.approver_supervisor_id??'00000000-0000-0000-0000-000000000000'}}))?.userId??null;
    return null;
  }
  private async coordinatorId(tx:SessionTx,work:Work,kind:string) {
    if(work.subjectRole!=='profesor'||kind==='EMERGENCY')return null;
    const coordinator=await tx.user.findFirst({where:{role:'coordinador-'+work.courseId,isActive:true},orderBy:{id:'asc'},select:{id:true}});
    if(!coordinator)throw new BadRequestException('Registra un coordinador activo para este curso antes de solicitar el reemplazo');
    return coordinator.id;
  }
  create(principal:SessionPrincipal,dto:ReplacementDraftDto,files:Express.Multer.File[]):Promise<ReplacementRequest>;
  create(principal:SessionPrincipal,dto:ReplacementDraftDto,files:Express.Multer.File[],preview:true):Promise<Buffer>;
  async create(
    principal: SessionPrincipal,
    dto: ReplacementDraftDto,
    files: Express.Multer.File[],
    preview = false,
  ):Promise<ReplacementRequest|Buffer> {
    const ctx = await this.contexts.get(principal);
    if (ctx.actor.role === Role.ADMIN)
      throw new ForbiddenException(
        'Administración resuelve solicitudes; no suplanta al solicitante',
      );
    files=describeEvidence(files,dto.annexDescriptions);
    if(dto.sameTurn && (dto.sameTurnReason?.trim().length??0)<10)throw new BadRequestException('Explica por qué no encontraste reemplazante de otro turno');
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          date: dto.date,
          kind: dto.kind,
          classId: dto.classId ?? null,
          hours: [...dto.hourSessionIds].sort((a, b) => a - b),
          replacement: dto.replacementUserId,
          reason: dto.reason.trim(),
          compress: dto.compress, sameTurn:dto.sameTurn??false,sameTurnReason:dto.sameTurnReason??'',address:dto.address??'',district:dto.district??'',cui:dto.cui??'',revisesId:dto.revisesId??null,coverageOperationId:dto.coverageOperationId??null,...(dto.annexDescriptions?{annexDescriptions:dto.annexDescriptions.map(value=>value.trim())}:{}),
          evidence: files.map((f) =>
            createHash('sha256').update(f.buffer).digest('hex'),
          ),
        }),
      )
      .digest('hex');
    const existing = await this.tx(
      ctx,
      (tx) =>
        tx.$queryRaw<
          ReplacementRequest[]
        >`SELECT * FROM replacement_requests WHERE operation_id=${dto.operationId}::uuid`,
    );
    if (existing.length && !preview) {
      if (
        existing[0].requester_user_id !== ctx.user.id ||
        existing[0].payload_sha256 !== payloadHash
      )
        throw new ConflictException('Operación ya utilizada');
      return existing[0];
    }
    const snapshot = await this.tx(ctx, async (tx) => {
      const work = await this.work(tx, ctx, dto, dto.hourSessionIds);
      const coordinatorId=await this.coordinatorId(tx,work,dto.kind);
      if((work.subjectRole==='monitor'||dto.kind==='EMERGENCY')&&!work.supervisorId)throw new BadRequestException('Asigna un supervisor antes de solicitar el reemplazo');
      if (!dto.coverageOperationId && work.blocks.some((b) => new Date(b.end) <= new Date()))
        throw new BadRequestException(
          'No se solicita reemplazo de trabajo ya finalizado',
        );
      const eligible = await tx.$queryRaw<
        { id: string; email: string; name: string; dni:string|null }[]
      >`SELECT u.id,u.email,p.dni,COALESCE(NULLIF(BTRIM(concat_ws(' ',p.first_name,p.last_name)),''),u.email) AS name ${this.candidateSql(work, ctx, dto.date, undefined, dto.replacementUserId)}`;
      if (!eligible.length)
        throw new BadRequestException(
          'El reemplazante no es compatible con los bloques',
        );
      const identities=await requestPeople(tx,[ctx.user.id,dto.replacementUserId]);
      const all=await this.work(tx,ctx,dto);
      const shift=await tx.shift.findUnique({where:{id:work.shiftId!}});
      return { work, replacement: eligible[0],coordinatorId, identities, full:work.fullCoverage??(all.blocks.filter(b=>b.shiftId===work.shiftId).length===work.blocks.length), shift:shift?.name??'Turno' };
    });
    const id = randomUUID(),
      name =
        [ctx.user.userProfile?.firstName, ctx.user.userProfile?.lastName]
          .filter(Boolean)
          .join(' ') || ctx.user.email;
    const fields = [
      { label: 'Solicitud', value: id },
      { label: 'Proceso', value: ctx.schema },
      {label:'Fecha de emisión',value:new Date().toLocaleDateString('es-PE',{timeZone:'America/Lima',day:'2-digit',month:'long',year:'numeric'})},
      {label:'Fecha del reemplazo',value:dto.date},
      {label:'Domicilio y distrito',value:[dto.address,dto.district].filter(Boolean).join(' / ')||'No declarado'},
      {label:'CUI',value:dto.cui||'No declarado'},
      {
        label: 'Solicitante',
        value:
          name +
          ' / ' +
          ctx.user.email +
          ' / DNI ' +
          (ctx.user.userProfile?.dni ?? 'no registrado'),
      },
      {
        label: 'Tipo',
        value:
          dto.kind === 'EMERGENCY'
            ? 'Emergencia por falta de docente'
            : 'Reemplazo de trabajo: ' + snapshot.work.subjectRole,
      },
      {
        label: 'Reemplazante propuesto',
        value: snapshot.replacement.name + ' / ' + snapshot.replacement.email + ' / DNI ' + (snapshot.replacement.dni??'No registrado'),
      },
      {
        label: 'Bloques',
        value: snapshot.work.blocks
          .map(
            (b) =>
              `${b.className} - ${b.course} - ${new Date(b.start).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false })} a ${new Date(b.end).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false })} (Lima)`,
          )
          .join('\n'),
      },
      { label: 'Motivo', value: dto.reason },
      ...(dto.annexDescriptions?[{label:'Anexos',value:files.map(file=>file.originalname).join('\n')}]:[]),
      ...(dto.sameTurn?[{label:'Excepción de mismo turno',value:'Declaro que no encontré reemplazante de otro turno. '+dto.sameTurnReason}]:[]),
    ];
    const time=(value:string)=>new Date(value).toLocaleTimeString('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit',hour12:false});
    const letter:LetterData={role:snapshot.work.subjectRole,process:ctx.schema,issued:fields.find(f=>f.label==='Fecha de emisión')!.value,date:dto.date.split('-').reverse().join('/'),
      applicant:snapshot.identities.find(p=>p.id===ctx.user.id)!, replacement:snapshot.identities.find(p=>p.id===dto.replacementUserId)!,
      address:dto.address??'',district:dto.district??'',cui:dto.cui??'',reason:dto.reason,
      exception:fields.find(f=>f.label==='Excepción de mismo turno')?.value,
      full:snapshot.full,classroom:snapshot.work.blocks[0].className,shift:snapshot.shift,course:snapshot.work.blocks[0].course,
      start:time(snapshot.work.blocks[0].start),end:time(snapshot.work.blocks.at(-1)!.end),
      hours:snapshot.work.blocks.map(b=>({classroom:b.className,start:time(b.start),end:time(b.end)}))};
    fields.push({label:'Ficha institucional',value:JSON.stringify(letter)});
    const bytes=await this.documents.generate(fields,files,dto.compress);
    if(preview)return bytes;
    const document=await this.documents.upload(ctx.schema,id,bytes);
    const wordBytes=await this.documents.word(fields,files,snapshot.work.subjectRole==='profesor');
    const wordDocument=await this.documents.upload(ctx.schema,id,wordBytes,'docx');
    let signals: { id: string; origin: string }[] = [];
    const saved = await this.tx(ctx, async (tx) => {
      if(dto.coverageOperationId){
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.schema+':coverage-document:'+dto.coverageOperationId},0))::text`;
        const [link]=await tx.$queryRaw<{request_id:string}[]>`SELECT request_id FROM session_coverage_document_links WHERE operation_id=${dto.coverageOperationId}::uuid FOR UPDATE`;
        if(link&&link.request_id!==dto.revisesId)throw new ConflictException('Esta cobertura ya tiene un documento. Revisa la solicitud existente.');
      }
      if(dto.revisesId){const parent=await this.read(tx,ctx,dto.revisesId,true);if(parent.requester_user_id!==ctx.user.id||parent.status!=='CHANGES'||parent.cancellation_stage)throw new ConflictException('La solicitud no está disponible para corrección');await tx.$executeRaw`UPDATE replacement_requests SET status='SUPERSEDED',version=version+1,decided_by=${JSON.stringify(ctx.actor)}::jsonb,decided_at=clock_timestamp(),decision_reason='Documento corregido y reenviado' WHERE id=${parent.id}::uuid`;await tx.$executeRaw`INSERT INTO replacement_request_events(request_id,action,actor,reason) VALUES(${parent.id}::uuid,'RESUBMITTED',${JSON.stringify(ctx.actor)}::jsonb,${id})`;}
      const work = await this.work(tx, ctx, dto, dto.hourSessionIds);
      if (!isDeepStrictEqual(work.blocks, snapshot.work.blocks))
        throw new ConflictException('Cambió el horario; revisa los bloques');
      const eligible = await tx.$queryRaw<
        { id: string }[]
      >`SELECT u.id ${this.candidateSql(work, ctx, dto.date, undefined, dto.replacementUserId)}`;
      if (!eligible.length)
        throw new ConflictException('El candidato dejó de estar disponible');
      const [r] = await tx.$queryRaw<
        ReplacementRequest[]
      >`INSERT INTO replacement_requests(id,requester_user_id,requester_role,subject_user_id,subject_role,kind,replacement_user_id,class_id,course_id,date,starts_at,ends_at,blocks,reason,approver_supervisor_id,pdf_object,pdf_generation,pdf_sha256,pdf_size,evidence_count,operation_id,payload_sha256,status,approver_coordinator_id,revises_id,same_turn_reason,document_data,docx_object,docx_generation,docx_sha256,coverage_operation_id) VALUES(${id}::uuid,${ctx.user.id}::uuid,${ctx.user.role},${work.subjectUserId}::uuid,${work.subjectRole},${dto.kind},${dto.replacementUserId}::uuid,${work.classId}::uuid,${work.courseId},${new Date(dto.date)}::date,${new Date(work.blocks[0].start)},${new Date(work.blocks[work.blocks.length - 1].end)},${JSON.stringify(work.blocks)}::jsonb,${dto.reason.trim()},${work.supervisorId}::uuid,${document.key},${document.generation},${document.checksum},${document.size},${files.length},${dto.operationId}::uuid,${payloadHash},${(work.subjectRole==='monitor'||(dto.kind==='EMERGENCY'&&ctx.actor.role===Role.MONITOR)||snapshot.coordinatorId)?'PENDING':'ADMIN_PENDING'},${snapshot.coordinatorId}::uuid,${dto.revisesId??null}::uuid,${dto.sameTurn ? dto.sameTurnReason!.trim() : ''},${JSON.stringify(fields)}::jsonb,${wordDocument.key},${wordDocument.generation},${wordDocument.checksum},${dto.coverageOperationId??null}::uuid) RETURNING *`;
      if(dto.coverageOperationId)await tx.$executeRaw`INSERT INTO session_coverage_document_links(operation_id,request_id) VALUES(${dto.coverageOperationId}::uuid,${r.id}::uuid) ON CONFLICT(operation_id) DO UPDATE SET request_id=EXCLUDED.request_id WHERE session_coverage_document_links.request_id=${dto.revisesId??null}::uuid`;
      await tx.$executeRaw`INSERT INTO replacement_request_events(request_id,action,actor,reason) VALUES(${r.id}::uuid,'REQUESTED',${JSON.stringify(ctx.actor)}::jsonb,${dto.reason.trim()})`;
      signals = await this.notify(
        tx,
        ctx,
        await this.approvers(tx, ctx, work),
        'REPLACEMENT_REQUESTED',
        'Solicitud de reemplazo',
        `${name} · ${work.blocks[0].className} · ${work.blocks
          .map((b) => b.course)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(', ')} · ${work.blocks.length} bloque(s) · ${dto.date}`,
        r.id,
        'REQUESTED',
      );
      return r;
    });
    for (const recipient of signals)
      this.changes.next({
        recipientId: recipient.id,
        origin: recipient.origin,
        schema: ctx.schema,
      });
    return saved;
  }
  private async scope(tx: SessionTx, ctx: Context) {
    if ([Role.ADMIN, Role.COORDINATOR].includes(ctx.actor.role)) return Prisma.sql`true`;
    if (ctx.actor.role === Role.SUPERVISOR) {
      const supervisor = await tx.supervisor.findUnique({
        where: { userId: ctx.user.id },
      });
    return Prisma.sql`(r.requester_user_id=${ctx.user.id}::uuid OR r.replacement_user_id=${ctx.user.id}::uuid OR (r.approver_supervisor_id=${supervisor?.id ?? null}::uuid AND (r.subject_role='monitor' OR r.kind='EMERGENCY')))`;
    }
    if(getCoordinatorCourseId(ctx.user.role))return Prisma.sql`(r.requester_user_id=${ctx.user.id}::uuid OR r.replacement_user_id=${ctx.user.id}::uuid OR (r.approver_coordinator_id=${ctx.user.id}::uuid AND r.course_id=${getCoordinatorCourseId(ctx.user.role)}))`;
    return Prisma.sql`(r.requester_user_id=${ctx.user.id}::uuid OR r.replacement_user_id=${ctx.user.id}::uuid)`;
  }
  async list(principal: SessionPrincipal, q: OperationPageDto) {
    const ctx = await this.contexts.get(principal);
    return this.tx(ctx, async (tx) => {
      const where = Prisma.sql`${await this.scope(tx, ctx)} ${q.status ? Prisma.sql`AND r.status=${q.status}` : Prisma.empty}`;
      const [data, total] = await Promise.all([
        tx.$queryRaw<
          ReplacementRequest[]
        >`SELECT r.*,(SELECT reason FROM replacement_application_issues issue WHERE issue.request_id=r.id ORDER BY issue.created_at DESC LIMIT 1) AS application_issue,u.email AS requester_email,c.email AS replacement_email FROM replacement_requests r JOIN users u ON u.id=r.requester_user_id JOIN users c ON c.id=r.replacement_user_id WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
        tx.$queryRaw<
          { total: number }[]
        >`SELECT count(*)::int total FROM replacement_requests r WHERE ${where}`,
      ]);
      const supervisor=ctx.actor.role===Role.SUPERVISOR?await tx.supervisor.findUnique({where:{userId:ctx.user.id}}):null;
      const legacy=data.filter(r=>!Array.isArray(r.document_data)||!r.document_data.some(f=>f.label==='Ficha institucional'));
      const legacyPeople=legacy.length?await requestPeople(tx,[...new Set(legacy.flatMap(r=>[r.requester_user_id,r.replacement_user_id]))]):[];
      const hourCounts=legacy.length?await tx.hourSession.groupBy({by:['shiftId'],_count:{id:true}}):[];
      const time=(value:string|undefined)=>value?new Date(value).toLocaleTimeString('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit',hour12:false}):'';
      const oldSummary=(r:ReplacementRequest)=>{
        const applicant=legacyPeople.find(p=>p.id===r.requester_user_id),replacement=legacyPeople.find(p=>p.id===r.replacement_user_id);
        const first=r.blocks[0],last=r.blocks.at(-1);
        return {applicant:applicant?{...applicant,...(r.subject_role==='monitor'?{classroom:first?.className}:{}),course:first?.course??applicant.course}:null,replacement,full:r.subject_role==='monitor'&&r.blocks.length===hourCounts.find(h=>h.shiftId===first?.shiftId)?._count.id,classroom:first?.className,course:first?.course,shift:applicant?.shift??'Turno registrado',start:time(first?.start),end:time(last?.end)};
      };
      const rows=data.map(r=>({...r,summary:(Array.isArray(r.document_data)?JSON.parse(r.document_data.find(f=>f.label==='Ficha institucional')?.value??'null'):null)??oldSummary(r),is_reviewer:(r.subject_role==='profesor'&&r.kind!=='EMERGENCY')?r.approver_coordinator_id===ctx.user.id:r.approver_supervisor_id===supervisor?.id}));
      return { data:rows, total: total[0].total, page: q.page, limit: q.limit };
    });
  }
  private async read(tx: SessionTx, ctx: Context, id: string, lock = false) {
    if (lock)
      await tx.$queryRaw`SELECT id FROM replacement_requests WHERE id=${id}::uuid FOR UPDATE`;
    const [r] = await tx.$queryRaw<
      ReplacementRequest[]
    >`SELECT r.* FROM replacement_requests r WHERE r.id=${id}::uuid AND ${await this.scope(tx, ctx)}`;
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    return r;
  }
  async detail(principal: SessionPrincipal, id: string) {
    const ctx = await this.contexts.get(principal);
    return this.tx(ctx, async (tx) => {
      const r = await this.read(tx, ctx, id);
      const events =
        await tx.$queryRaw`SELECT action,reason,created_at FROM replacement_request_events WHERE request_id=${id}::uuid ORDER BY id`;
      return { ...r, events };
    });
  }
  async pdf(principal: SessionPrincipal, id: string) {
    const ctx = await this.contexts.get(principal);
    const r = await this.tx(ctx, (tx) => this.read(tx, ctx, id));
    return this.documents.download(
      r.pdf_object,
      r.pdf_generation,
      r.pdf_sha256,
    );
  }
  async word(principal:SessionPrincipal,id:string){const ctx=await this.contexts.get(principal);const r=await this.tx(ctx,tx=>this.read(tx,ctx,id));if(!r.docx_object||!r.docx_generation||!r.docx_sha256)throw new BadRequestException('Esta solicitud histórica solo contiene PDF');return this.documents.download(r.docx_object,r.docx_generation,r.docx_sha256,10*1024*1024);}
  async decide(
    principal: SessionPrincipal,
    id: string,
    dto: RequestDecisionDto,
  ) {
    const ctx = await this.contexts.get(principal);
    if (ctx.user.role === Role.COORDINATOR)
      throw new ForbiddenException('La coordinación general solo consulta solicitudes');
    const reason=dto.reason?.trim() || (['APPROVED','APPROVE_CANCEL'].includes(dto.status)?'Conforme':'' );
    if(reason.length<3)throw new BadRequestException('Indica el motivo del rechazo, corrección o cancelación');
    let signals: { id: string; origin: string }[] = [];
    const saved = await this.tx(ctx, async (tx) => {
      const r = await this.read(tx, ctx, id, true);
      if(r.version!==dto.expectedVersion)throw new ConflictException('La solicitud cambió o ya fue resuelta');
      const reviewerId=await this.reviewerId(tx,r);
      const next=replacementDecision(r,dto.status,{id:ctx.user.id,admin:ctx.actor.role===Role.ADMIN,reviewer:reviewerId===ctx.user.id},Boolean(reviewerId));
      if(next.revoke)await this.revokeReplacement(tx,ctx,r,reason);
      if (next.apply && !r.coverage_operation_id) {
        if(r.subject_role==='monitor')await tx.$queryRaw`SELECT id FROM monitors WHERE user_id=${r.replacement_user_id}::uuid FOR UPDATE`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(${r.date.toISOString().slice(0, 10)}))`;
        await tx.$queryRaw`SELECT id FROM users WHERE id=${r.replacement_user_id}::uuid FOR UPDATE`;
        const occupied = await tx.$queryRaw<
          { id: string }[]
        >`SELECT r.id FROM replacement_requests r WHERE r.status='APPROVED' AND r.date=${r.date}::date AND r.subject_role=${r.subject_role} AND r.subject_user_id IS NOT DISTINCT FROM ${r.subject_user_id}::uuid AND r.class_id IS NOT DISTINCT FROM ${r.class_id}::uuid AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.blocks) a CROSS JOIN jsonb_array_elements(${JSON.stringify(r.blocks)}::jsonb) b WHERE (a->>'start')::timestamptz<(b->>'end')::timestamptz AND (a->>'end')::timestamptz>(b->>'start')::timestamptz) LIMIT 1`;
        if (occupied.length)
          throw new ConflictException(
            'Ya existe un reemplazo aprobado para ese trabajo',
          );
        const recorded = ['profesor','monitor'].includes(r.subject_role) ? await tx.$queryRaw<
          { id: number }[]
        >`SELECT rec.id FROM class_session_records rec WHERE rec.date=${r.date}::date AND EXISTS(SELECT 1 FROM jsonb_array_elements(${JSON.stringify(r.blocks)}::jsonb) b WHERE rec.hour_session_id=(b->>'hourSessionId')::int AND rec.class_id=(b->>'classId')::uuid) AND (rec.actual_start IS NOT NULL OR rec.actual_end IS NOT NULL OR EXISTS(SELECT 1 FROM session_coverages c WHERE c.record_id=rec.id AND c.status IN ('PENDING','AUTHORIZED') AND c.kind=CASE WHEN ${r.subject_role}='profesor' THEN 'TEACHER' ELSE 'MONITOR' END)) LIMIT 1` : [];
        if (recorded.length)
          throw new ConflictException(
            'Un bloque ya tiene ejecución o cobertura; requiere revisión administrativa',
          );
        const requester = await tx.user.findUnique({
          where: { id: r.requester_user_id },
          include: { userProfile: true },
        });
        if (!requester?.isActive || requester.role !== r.requester_role)
          throw new ConflictException('La cuenta solicitante cambió');
        const owner = {
          ...ctx,
          user: requester,
          actor: {
            ...ctx.actor,
            id: requester.id,
            email: requester.email,
            role: requester.role as Role,
            origin: ctx.schema,
          },
        };
        const q = {
          date: r.date.toISOString().slice(0, 10),
          kind: r.kind,
          classId: r.class_id ?? undefined, sameTurn:Boolean(r.same_turn_reason),
        };
        const w = await this.work(
          tx,
          owner,
          q,
          r.blocks.map((b) => b.hourSessionId),
        );
        if (!isDeepStrictEqual(w.blocks, r.blocks))
          throw new ConflictException(
            'Cambió la programación; debe emitirse una nueva solicitud',
          );
        if (r.blocks.some((b) => new Date(b.end) <= new Date()))
          throw new BadRequestException('El trabajo solicitado ya terminó');
        const eligible = await tx.$queryRaw<
          { id: string }[]
        >`SELECT u.id ${this.candidateSql(w, owner, q.date, undefined, r.replacement_user_id)}`;
        if (!eligible.length)
          throw new ConflictException('El reemplazante ya no está disponible');
      }
      const [updated] = await tx.$queryRaw<
        ReplacementRequest[]
      >`UPDATE replacement_requests SET status=${next.status},cancellation_stage=${next.cancellationStage},cancellation_reason=CASE WHEN ${next.event}='CANCELLATION_REQUESTED' THEN ${reason} ELSE cancellation_reason END,reviewed_by=CASE WHEN ${next.event}='REVIEW_APPROVED' THEN ${JSON.stringify(ctx.actor)}::jsonb ELSE reviewed_by END,reviewed_at=CASE WHEN ${next.event}='REVIEW_APPROVED' THEN clock_timestamp() ELSE reviewed_at END,version=version+1,decided_by=${JSON.stringify(ctx.actor)}::jsonb,decision_reason=${reason},decided_at=clock_timestamp() WHERE id=${id}::uuid RETURNING *`;
      await tx.$executeRaw`INSERT INTO replacement_request_events(request_id,action,actor,reason) VALUES(${id}::uuid,${next.event},${JSON.stringify(ctx.actor)}::jsonb,${reason})`;
      if(next.apply&&r.coverage_operation_id){
        await tx.$executeRaw`UPDATE session_coverages SET status='AUTHORIZED',resolved_by=${JSON.stringify(ctx.actor)}::jsonb,resolved_at=clock_timestamp() WHERE operation_id=${r.coverage_operation_id}::uuid AND status='PENDING'`;
        await tx.$executeRaw`INSERT INTO session_audit_events(record_id,action,actor,after,reason) SELECT record_id,'DOCUMENT_APPROVED',${JSON.stringify(ctx.actor)}::jsonb,to_jsonb(c),'Documento posterior revisado y autorizado' FROM session_coverages c WHERE operation_id=${r.coverage_operation_id}::uuid`;
      }
      if (next.apply && !r.coverage_operation_id) await this.applyApproved(tx);
      const recipients = [
        { id: r.requester_user_id, origin: ctx.schema },
        ...(next.apply
          ? [{ id: r.replacement_user_id, origin: ctx.schema }]
          : []),
      ];
      if(next.status==='ADMIN_PENDING'||next.cancellationStage==='ADMIN'){const admins=await tx.$queryRaw<{id:string}[]>`SELECT id FROM core_schema.users WHERE role='administrador' AND is_active`;recipients.push(...admins.map(a=>({id:a.id,origin:'core_schema'})));}
      if(next.cancellationStage==='REVIEW'&&reviewerId)recipients.push({id:reviewerId,origin:ctx.schema});
      signals = await this.notify(
        tx,
        ctx,
        recipients,
        'REPLACEMENT_' + next.event.replace('CANCELLATION_','CANCEL_'),
        'Solicitud ' +
          ({
            APPROVED: 'aprobada',
            REJECTED: 'rechazada',
            CANCELLED: 'cancelada',
          }[next.event] ?? ({ADMIN_PENDING:'enviada a administración',REVIEW_APPROVED:'revisada; pendiente de permiso administrativo',CHANGES:'devuelta para corregir',CANCELLATION_REQUESTED:'con cancelación solicitada',CANCELLATION_REVIEWED:'con cancelación remitida al administrador',CANCELLATION_CHANGES:'con cancelación por corregir',CANCELLATION_REJECTED:'con cancelación rechazada'}[next.event]??next.event)),
        `${r.date.toISOString().slice(0, 10)} · ${r.blocks.length} bloque(s). ${reason}`,
        id,
        next.event+':'+updated.version,
      );
      return updated;
    });
    for (const recipient of signals)
      this.changes.next({
        recipientId: recipient.id,
        origin: recipient.origin,
        schema: ctx.schema,
      });
    return saved;
  }
  private async revokeReplacement(tx:SessionTx,ctx:Context,r:ReplacementRequest,reason:string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(${r.date.toISOString().slice(0,10)}))`;
    const blocked=await tx.$queryRaw<{id:number}[]>`SELECT rec.id FROM replacement_application_snapshots saved JOIN class_session_records rec ON rec.id=saved.record_id WHERE saved.request_id=${r.id}::uuid AND (rec.actual_start IS NOT NULL OR rec.actual_end IS NOT NULL OR rec.version<>saved.applied_version OR clock_timestamp()>=rec.scheduled_start) FOR UPDATE OF rec`;
    if(blocked.length)throw new ConflictException('La cobertura ya comenzó o tiene cambios registrados. No se pueden borrar ni revertir sus hechos automáticamente.');
    const missing=await tx.$queryRaw<{id:number}[]>`SELECT c.id FROM session_coverages c WHERE c.operation_id=${r.id}::uuid AND c.status='AUTHORIZED' AND NOT EXISTS(SELECT 1 FROM replacement_application_snapshots saved WHERE saved.request_id=${r.id}::uuid AND saved.record_id=c.record_id)`;
    if(missing.length)throw new ConflictException('La cobertura histórica requiere revisión administrativa antes de cancelarse');
    await tx.$queryRaw`SELECT set_config('cepr.session_override','true',true)`;
    await tx.$executeRaw`UPDATE session_coverages SET status='REVOKED',resolved_by=${JSON.stringify(ctx.actor)}::jsonb,resolved_at=clock_timestamp() WHERE operation_id=${r.id}::uuid AND status='AUTHORIZED'`;
    await tx.$executeRaw`WITH original AS MATERIALIZED(SELECT rec.id,to_jsonb(rec) before,saved.before_value FROM replacement_application_snapshots saved JOIN class_session_records rec ON rec.id=saved.record_id WHERE saved.request_id=${r.id}::uuid), changed AS(UPDATE class_session_records rec SET class_state=o.before_value->>'class_state',effective_teacher_id=(o.before_value->>'effective_teacher_id')::uuid,effective_monitor_id=(o.before_value->>'effective_monitor_id')::uuid,effective_snapshot=o.before_value->'effective_snapshot',monitor_account_id=(o.before_value->>'monitor_account_id')::uuid,version=rec.version+1,updated_at=clock_timestamp() FROM original o WHERE rec.id=o.id RETURNING rec.*) INSERT INTO session_audit_events(record_id,action,actor,before,after,reason) SELECT c.id,'CANCELLATION_APPLIED',${JSON.stringify(ctx.actor)}::jsonb,o.before,to_jsonb(c),${reason.trim()} FROM changed c JOIN original o ON o.id=c.id`;
  }
  /** Aplicación por conjuntos de excepciones diarias: jamás cambia el horario semanal. */
  async applyApproved(tx: SessionTx) {
    await applyApprovedReplacements(tx);
  }
  async notifications(principal: SessionPrincipal, q: OperationPageDto) {
    const ctx = await this.contexts.get(principal);
    if (![Role.ADMIN, Role.MONITOR, Role.SUPERVISOR, Role.TEACHER].includes(ctx.actor.role) && !parseCoordinatorRole(ctx.user.role).isCoordinator) throw new ForbiddenException('Rol sin avisos');
    return this.tx(ctx, async tx => {
      const [result] = await tx.$queryRaw<{data:unknown[];total:number;pending:number}[]>`
        WITH notices AS (
          SELECT n.id,n.kind,n.title,n.message,n.request_id,n.resolved_at,n.created_at,
            n.kind LIKE 'part.pending.%' AND (r.id IS NULL OR r.deleted_at IS NOT NULL OR CASE split_part(n.kind,'.',3)
              WHEN 'start' THEN r.actual_start IS NOT NULL OR r.teaching_status<>'UNCONFIRMED'
              WHEN 'end' THEN r.actual_end IS NOT NULL OR r.teaching_status='NOT_TAUGHT'
              WHEN 'initial' THEN r.initial_file_id IS NOT NULL OR r.teaching_status='NOT_TAUGHT'
              WHEN 'final' THEN r.final_file_id IS NOT NULL OR r.teaching_status='NOT_TAUGHT' ELSE false END) obsolete
          FROM public.operation_notifications n LEFT JOIN class_session_records r ON r.id=CASE WHEN n.kind LIKE 'part.pending.%' AND split_part(n.dedupe_key,':',3) ~ '^[0-9]{1,9}$' THEN split_part(n.dedupe_key,':',3)::int ELSE NULL END
          WHERE n.recipient_id=${ctx.user.id}::uuid AND n.recipient_origin=${ctx.actor.origin} AND n.process_schema=${ctx.schema}
        )
        SELECT (SELECT count(*)::int FROM notices) total,
          (SELECT count(*)::int FROM notices WHERE resolved_at IS NULL AND NOT obsolete) pending,
          COALESCE((SELECT jsonb_agg(page) FROM (SELECT * FROM notices ORDER BY created_at DESC,id DESC LIMIT ${q.limit} OFFSET ${(q.page-1)*q.limit}) page),'[]'::jsonb) data`;
      return {...result,page:q.page,limit:q.limit};
    });
  }
  async streamRecords(ctx: Context, changed: [number, number][], permitted: { id: number; version: number; force?: boolean }[]) {
    if (!changed.length) return;
    const rows = await ctx.client.classSessionRecord.findMany({ where: { id: { in: changed.map(([id]) => id) }, ...(await this.records.scope(ctx.client, ctx.actor)) }, select: { id: true, version: true } });
    permitted.push(...rows.map(row => ({ ...row, force: changed.some(([id, version]) => id === row.id && version === 0) })));
  }
  async resolveNotifications(principal: SessionPrincipal, id?: string) {
    const ctx = await this.contexts.get(principal);
    return this.tx(ctx, async tx => {
    if (id) {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`UPDATE public.operation_notifications SET resolved_at=COALESCE(resolved_at,clock_timestamp()) WHERE id=${id}::uuid AND recipient_id=${ctx.user.id}::uuid AND recipient_origin=${ctx.actor.origin} AND process_schema=${ctx.schema} RETURNING id`;
      if (!rows.length)
        throw new NotFoundException('Notificación no encontrada');
    } else
      await tx
        .$executeRaw`UPDATE public.operation_notifications SET resolved_at=clock_timestamp() WHERE recipient_id=${ctx.user.id}::uuid AND recipient_origin=${ctx.actor.origin} AND process_schema=${ctx.schema} AND resolved_at IS NULL`;
    await tx.$executeRaw`SELECT pg_notify('operations_changed',${JSON.stringify({schema:ctx.schema,recipients:[{id:ctx.user.id,origin:ctx.actor.origin}]})})`;
    return { resolved: true };
    });
  }
}
