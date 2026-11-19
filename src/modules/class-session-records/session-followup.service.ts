import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RuntimeConfigService } from '@modules/runtime-config/runtime-config.service';
import { SchemaManagerService } from '@database/schema-manager/schema-manger.service';
import { ClassSessionRecordsService } from './class-session-records.service';
import { limaDate, SessionJournalService } from './session-journal.service';
import { SessionPrincipal, systemActor } from './session.types';
import { Role } from '@modules/auth/decorators/authorization.decorator';

@Injectable()
export class SessionFollowupService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(SessionFollowupService.name);
  constructor(
    private readonly records: ClassSessionRecordsService,
    private readonly journal: SessionJournalService,
    private readonly runtime: RuntimeConfigService,
    private readonly schemas: SchemaManagerService,
    private readonly config: ConfigService,
  ) {}
  onModuleInit() {
    if (this.config.get('CLASS_RECORDS_TASK_ENABLED', 'false') !== 'true')
      return;
    // ponytail: one minute internal notifications only; move to a queue if workload requires it.
    this.timer = setInterval(() => {
      void this.tick().catch((error) => this.logger.error(String(error)));
    }, 60000);
    this.timer.unref();
    void this.tick().catch((error) => this.logger.error(String(error)));
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const runtime = await this.runtime.getCurrent();
      // Fail closed without a valid runtime document; never fall back to default client.
      if (!runtime || runtime.maintenance.enabled) return;
      const available = await this.schemas.getAllWithCache();
      const core = this.config.get<string>('CORE_SCHEMA', 'core_schema');
      for (const { name: schema } of available) {
        if (schema === 'public' || schema === core) continue;
        try {
          // Config per academic schema explicitly opts processes in/out, including historic processes.
          const client = this.records.prisma.getClientForSchema(schema);
          const present = await client.$queryRaw<
            { present: boolean }[]
          >`SELECT to_regclass(${`"${schema}".session_operational_config`}) IS NOT NULL AS present`;
          if (!present[0]?.present) continue;
          const now = await this.records.transaction(client, schema, (tx) =>
            this.records.now(tx),
          );
          const routed = [runtime.schemaRouting?.adminSchema,runtime.schemaRouting?.userSchema].includes(schema);
          // A saved advance must still execute if administration switches the visible process.
          const planned = !routed && runtime.schemaRouting
            ? await this.records.transaction(client, schema, tx => tx.$queryRaw<{present:boolean}[]>`SELECT EXISTS(SELECT 1 FROM session_week_plans WHERE advanced_weekday IS NOT NULL AND generated_at IS NULL AND week_start BETWEEN ${new Date(limaDate(now))}::date-6 AND ${new Date(limaDate(now))}::date+8) AS present`)
            : [];
          if (routed || planned[0]?.present)
            await this.journal.ensureWeeklyGeneration(client, schema);
          await this.journal.materialize(client, schema, limaDate(now));
          await this.generate(schema);
        } catch (error) {
          this.logger.error(
            `Seguimiento falló en ${schema}; continúan los demás procesos: ${String(error)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
  async generate(schema: string) {
    const client = this.records.prisma.getClientForSchema(schema);
    const actor = systemActor(schema);
    return this.records.transaction(client, schema, async (tx) => {
      const [lock] = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${schema + ':session-followup'},0)) AS locked`;
      if (!lock.locked) return { created: 0 };
      const now = await this.records.now(tx);
      const config = await tx.sessionOperationalConfig.findUniqueOrThrow({
        where: { id: 1 },
      });
      if (!config.enabled) return { created: 0 };
      await tx.$executeRaw`WITH late AS MATERIALIZED(SELECT id,to_jsonb(r) before FROM class_session_records r WHERE deleted_at IS NULL AND actual_start IS NULL AND (class_state IS NULL OR class_state='N') AND date=${new Date(limaDate(now))}::date AND jsonb_typeof(timing_policy->'latenessToleranceMinutes')='number' AND scheduled_start+make_interval(mins=>(timing_policy->>'latenessToleranceMinutes')::int)<${now} AND NOT EXISTS(SELECT 1 FROM session_coverages c WHERE c.record_id=r.id AND c.status IN ('AUTHORIZED','PENDING') AND c.kind='TEACHER')),
        changed AS(UPDATE class_session_records r SET class_state='T',timing_policy=r.timing_policy||'{"automaticLateness":true}'::jsonb,version=r.version+1,updated_at=${now} FROM late l WHERE r.id=l.id RETURNING r.*)
        INSERT INTO session_audit_events(record_id,action,actor,before,after,reason) SELECT c.id,'AUTO_LATENESS',${JSON.stringify(actor)}::jsonb,l.before,to_jsonb(c),'Superó la tolerancia de ingreso configurada para el proceso' FROM changed c JOIN late l ON l.id=c.id`;
      const inserted = await tx.$queryRaw<{ id: number; record_id: number }[]>`
        INSERT INTO session_alerts(record_id,type,supervisor_id)
        SELECT r.id,'NO_START_CONFIRMATION',r.supervisor_id FROM class_session_records r
        WHERE r.deleted_at IS NULL AND r.actual_start IS NULL AND r.teaching_status='UNCONFIRMED'
          AND r.timing_policy->>'alertThresholdMinutes' IS NOT NULL
          AND r.date=${new Date(limaDate(now))}::date
          AND r.scheduled_start+make_interval(mins=>(r.timing_policy->>'alertThresholdMinutes')::int)<=${now}
        ON CONFLICT(record_id,type) DO NOTHING RETURNING id,record_id`;
      for (const alert of inserted)
        await this.records.audit(
          tx,
          actor,
          alert.record_id,
          'ALERT_CREATED',
          null,
          alert,
        );
      const admins = await this.records.prisma.getClientForSchema('core_schema').user.findMany({ where: { role: String(Role.ADMIN), isActive: true }, select: { id: true } });
      // Set-based reminders; only today's facts, never an inferred personal absence.
      const notices = await tx.$queryRaw<{ id: string }[]>`
        WITH pending AS (
          SELECT r.*, issue.kind, issue.due_at,
            (r.timing_policy->>'alertThresholdMinutes')::int reminder,
            (r.timing_policy->>'escalationDelayMinutes')::int escalation
          FROM class_session_records r
          CROSS JOIN LATERAL (VALUES
            ('start',r.scheduled_start,r.actual_start IS NULL AND r.teaching_status='UNCONFIRMED'),
            ('end',r.scheduled_end,r.actual_end IS NULL AND r.teaching_status IN ('UNCONFIRMED','TAUGHT','INTERRUPTED')),
            ('initial',r.scheduled_start,r.initial_file_id IS NULL AND r.teaching_status<>'NOT_TAUGHT'),
            ('final',r.scheduled_end,r.final_file_id IS NULL AND r.teaching_status<>'NOT_TAUGHT')
          ) issue(kind,due_at,missing)
          WHERE r.date=${new Date(limaDate(now))}::date AND r.deleted_at IS NULL AND issue.missing
            AND r.timing_policy->>'alertThresholdMinutes' IS NOT NULL
            AND issue.due_at+make_interval(mins=>(r.timing_policy->>'alertThresholdMinutes')::int)<=${now}
        ), recipients AS (
          SELECT p.id,p.kind,p.period,p.date,p.supervisor_id,p.due_at,p.reminder,p.escalation,u.id recipient_id,${schema} recipient_origin,'reminder' stage
          FROM pending p JOIN users u ON u.id=p.monitor_account_id AND u.is_active AND u.role='monitor'
          UNION ALL
          SELECT p.id,p.kind,p.period,p.date,p.supervisor_id,p.due_at,p.reminder,p.escalation,u.id,${schema},'escalation'
          FROM pending p JOIN supervisors s ON s.id=p.supervisor_id JOIN users u ON u.id=s.user_id AND u.is_active
          WHERE p.escalation IS NOT NULL AND p.due_at+make_interval(mins=>p.reminder+p.escalation)<=${now}
          UNION ALL
          SELECT p.id,p.kind,p.period,p.date,p.supervisor_id,p.due_at,p.reminder,p.escalation,a.id::uuid,'core_schema','escalation'
          FROM pending p CROSS JOIN jsonb_to_recordset(${JSON.stringify(admins)}::jsonb) a(id text)
          WHERE p.escalation IS NOT NULL AND p.due_at+make_interval(mins=>p.reminder+p.escalation)<=${now}
        )
        INSERT INTO public.operation_notifications(recipient_id,recipient_origin,process_schema,kind,title,message,dedupe_key)
        SELECT recipient_id,recipient_origin,${schema},'part.pending.'||kind||'.'||stage,
          CASE kind WHEN 'start' THEN 'Inicio real sin confirmar' WHEN 'end' THEN 'Fin real sin confirmar' ELSE 'Captura pendiente de registro' END,
          date::text||' · bloque '||period||'. Falta un registro; no se afirma ausencia ni sanción.'||CASE WHEN stage='escalation' AND supervisor_id IS NULL THEN ' Sin supervisor asignado: escalado a administración.' ELSE '' END,
          ${schema}||':pending:'||id||':'||kind||':'||stage
        FROM recipients ON CONFLICT(recipient_id,recipient_origin,dedupe_key) DO NOTHING RETURNING id`;
      if (notices.length) await tx.$executeRaw`SELECT pg_notify('operations_changed',${JSON.stringify({schema})})`;
      return { created: inserted.length };
    });
  }
  async alerts(principal: SessionPrincipal, page = 1) {
    const { client, actor } = await this.records.context(principal);
    if (actor.role === Role.MONITOR) this.records.admin(actor);
    return client.sessionAlert.findMany({
      where: { record: await this.records.scope(client, actor) },
      orderBy: { id: 'desc' },
      take: 50,
      skip: (page - 1) * 50,
    });
  }
  async acknowledge(principal: SessionPrincipal, id: number) {
    const { client, actor } = await this.records.context(principal);
    if (actor.role === Role.MONITOR) this.records.admin(actor);
    return this.records.transaction(client, actor.schema, async (tx) => {
      const alert = await tx.sessionAlert.findUniqueOrThrow({ where: { id } });
      await this.records.lock(tx, alert.recordId);
      await this.records.authorizeRecord(tx, actor, alert.recordId);
      const current = await tx.sessionAlert.findUniqueOrThrow({
        where: { id },
      });
      if (current.acknowledgedAt) return current;
      const updated = await tx.sessionAlert.update({
        where: { id },
        data: {
          acknowledgedAt: await this.records.now(tx),
          acknowledgedBy: { ...actor },
        },
      });
      await this.records.audit(
        tx,
        actor,
        alert.recordId,
        'ALERT_ACKNOWLEDGED',
        current,
        updated,
      );
      return updated;
    });
  }
}
