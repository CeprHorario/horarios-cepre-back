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
          await this.journal.materialize(client, schema, limaDate());
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
      const config = await tx.sessionOperationalConfig.findUniqueOrThrow({
        where: { id: 1 },
      });
      if (!config.enabled) return { created: 0 };
      const inserted = await tx.$queryRaw<{ id: number; record_id: number }[]>`
        INSERT INTO session_alerts(record_id,type,supervisor_id)
        SELECT r.id,'NO_START_CONFIRMATION',r.supervisor_id FROM class_session_records r
        WHERE r.deleted_at IS NULL AND r.actual_start IS NULL AND r.teaching_status='UNCONFIRMED'
          AND r.timing_policy->>'alertThresholdMinutes' IS NOT NULL
          AND r.scheduled_start+make_interval(mins=>(r.timing_policy->>'alertThresholdMinutes')::int)<=clock_timestamp()
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
