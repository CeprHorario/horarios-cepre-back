import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Client } from 'pg';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { ClassSessionRecordsService } from '../src/modules/class-session-records/class-session-records.service';
import { SessionJournalService } from '../src/modules/class-session-records/session-journal.service';
import { SessionFollowupService } from '../src/modules/class-session-records/session-followup.service';
import { OperationsService } from '../src/modules/operations/operations.service';
import { OperationsContext } from '../src/modules/operations/operations-context.service';
import { RequestDocuments } from '../src/modules/operations/request-document.service';
import { RuntimeConfigService } from '../src/modules/runtime-config/runtime-config.service';
import { installPartTestClock } from './helpers/part-test-clock';
import { SessionFilesFixture } from './helpers/session-files-fixtures';

const suite=process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('Cierre funcional de Partes: avisos, tiempo, sustituciones y señales',()=>{
  const fixture=new SessionFilesFixture();
  const schemas={assertAvailable:async()=>{}} as unknown as SchemaManagerService;
  const records=new ClassSessionRecordsService(fixture.apiPrisma as unknown as PrismaService,fixture.context,schemas);
  const journal=new SessionJournalService(records);
  const contexts=new OperationsContext(fixture.apiPrisma as unknown as PrismaService,fixture.context,schemas);
  const operations=new OperationsService(contexts,records,{} as RequestDocuments);
  let clock:Awaited<ReturnType<typeof installPartTestClock>>, monitorId:string, substituteId:string,teacherId:string,candidateId:string;
  let period=1;
  const run=<T>(work:()=>Promise<T>)=>fixture.context.run({schema:fixture.schema,routing:{adminSchema:fixture.schema,userSchema:fixture.schema}},work);
  const fresh=async()=>{const hour=await fixture.client().hourSession.create({data:{id:++period,period,shiftId:1,startTime:new Date('1970-01-01T08:00Z'),endTime:new Date('1970-01-01T08:40Z')}});return fixture.client().classSessionRecord.create({data:{date:new Date('2026-11-03'),classId:fixture.classId,hourSessionId:hour.id,shiftId:1,areaId:1,courseId:1,period,pedagogicalMinutes:40,scheduledStart:new Date('2026-11-03T13:00Z'),scheduledEnd:new Date('2026-11-03T13:40Z'),shiftEnd:new Date('2026-11-03T13:40Z'),editDeadline:new Date('2026-11-03T15:10Z'),titularMonitorId:monitorId,titularTeacherId:teacherId,monitorAccountId:fixture.principals.monitor.userId,supervisorId:fixture.supervisorId,snapshot:{className:'Aula sintética',course:'Curso sintético'},timingPolicy:{alertThresholdMinutes:2,escalationDelayMinutes:5}}});};
  beforeAll(async()=>{
    await fixture.initialize(); const db=fixture.client();
    monitorId=(await db.monitor.create({data:{userId:fixture.principals.monitor.userId,supervisorId:fixture.supervisorId}})).id;
    substituteId=(await db.monitor.create({data:{userId:fixture.principals.otherMonitor.userId}})).id;
    await db.class.update({where:{id:fixture.classId},data:{monitorId}});
    await db.shift.create({data:{id:2,name:'Turno sustituto',startTime:new Date('1970-01-01T16:00Z'),endTime:new Date('1970-01-01T21:10Z')}});
    await db.class.create({data:{name:'Salón del monitor sustituto',idSede:1,areaId:1,shiftId:2,monitorId:substituteId}});
    teacherId=(await db.teacher.create({data:{userId:fixture.principals.teacher.userId,courseId:1,jobStatus:'PartTime'}})).id;
    const user=await db.user.create({data:{email:'candidate-completion@test.invalid',role:'profesor'}});
    candidateId=(await db.teacher.create({data:{userId:user.id,courseId:1,jobStatus:'PartTime'}})).id;
    await db.teacherAvailability.create({data:{teacherId:candidateId,weekday:'Martes',startMinute:0,endMinute:1440}});
    await db.user.create({data:{email:'other-course-coordination@test.invalid',role:'coordinador-2'}});
    await db.sessionOperationalConfig.update({where:{id:1},data:{enabled:true,startsOn:new Date('2026-01-01'),endsOn:new Date('2026-12-31')}});
    clock=await installPartTestClock(db,fixture.schema);
  });
  afterAll(async()=>{
    await fixture.pg.query('DELETE FROM public.operation_notifications WHERE process_schema=$1',[fixture.schema]);
    await fixture.close();
  });
  it('100 ticks y dos instancias: una notificación por dato/etapa/destinatario; completar vuelve obsoleto el aviso',async()=>{
    await clock.set(new Date('2026-11-03T14:00Z'),0);
    const record=await fresh();
    const followup=new SessionFollowupService(records,journal,{} as RuntimeConfigService,schemas,new ConfigService());
    const other=new SessionFollowupService(records,journal,{} as RuntimeConfigService,schemas,new ConfigService());
    for(let i=0;i<100;i++) await Promise.all([followup.generate(fixture.schema),other.generate(fixture.schema)]);
    const counts=await fixture.pg.query<{count:number}>(`SELECT count(*)::int count FROM public.operation_notifications WHERE process_schema=$1 AND dedupe_key LIKE $2`,[fixture.schema,`${fixture.schema}:pending:${record.id}:%`]);
    expect(counts.rows[0].count).toBe(12);
    await run(()=>records.update(fixture.principals.admin,record.id,{expectedVersion:record.version,actualStart:'2026-11-03T13:01:00Z',reason:'Corrección sintética explícita'},true));
    const notices=await run(()=>operations.notifications(fixture.principals.monitor,{page:1,limit:100}));
    expect(notices.pending).toBe(3);
    expect((notices.data as {kind:string;obsolete:boolean}[]).find(notice=>notice.kind==='part.pending.start.reminder')?.obsolete).toBe(true);
  });
  it('propuesta pendiente dirige resumen a elegibles y coordinación correcta; reintento no duplica',async()=>{
    await clock.set(new Date('2026-11-03T13:10Z'),0);
    const record=await fresh(), operationId=randomUUID();
    const dto={expectedVersion:record.version,classState:'RN',replacementEmail:'candidate-completion@test.invalid',operationId};
    const saved=await run(()=>records.update(fixture.principals.monitor,record.id,dto));
    const repeated=await run(()=>records.update(fixture.principals.monitor,record.id,dto));
    expect(saved.version).toBe(repeated.version); expect(saved.effectiveTeacherId).toBe(candidateId); expect(saved.teachingStatus).toBe('UNCONFIRMED');
    const candidate=await fixture.client().teacher.findUniqueOrThrow({where:{id:candidateId}});
    const recipients=await fixture.pg.query<{recipient_id:string;message:string}>(`SELECT recipient_id,message FROM public.operation_notifications WHERE process_schema=$1 AND dedupe_key LIKE $2`,[fixture.schema,`${fixture.schema}:part-coverage:%:proposed:%`]);
    expect(recipients.rows.map(row=>row.recipient_id)).toEqual(expect.arrayContaining([candidate.userId,fixture.principals.coordinator.userId]));
    const other=await fixture.client().user.findUniqueOrThrow({where:{email:'other-course-coordination@test.invalid'}});
    expect(recipients.rows.some(row=>row.recipient_id===other.id)).toBe(false);
    expect(recipients.rows.some(row=>/captura|DNI|contraseña|monitor@/i.test(row.message))).toBe(false);
    await expect(run(()=>journal.resolve(fixture.principals.supervisor,saved.coverages[0].id,{expectedVersion:saved.version,status:'AUTHORIZED',reason:'No se autoriza desde supervisión'}))).rejects.toThrow('administrativa');
  });
  it('sustitución masiva idempotente y revocación administrativa no borran al efectivo ejecutado',async()=>{
    const record=await fresh();
    const dto={targets:[{recordId:record.id,expectedVersion:record.version}],kind:'MONITOR',personId:substituteId,mode:'PLANNED',reason:'Sustitución sintética explícita',operationId:randomUUID()};
    const result=await run(()=>journal.cover(fixture.principals.admin,dto));
    const repeated=await run(()=>journal.cover(fixture.principals.admin,dto));
    expect(result.operationId).toBe(repeated.operationId);
    await expect(run(()=>journal.cover(fixture.principals.admin,{...dto,reason:'Otra intención'}))).rejects.toThrow('otra intención');
    const current=await fixture.client().classSessionRecord.findUniqueOrThrow({where:{id:record.id}});
    const executed=await run(()=>records.update(fixture.principals.monitor,record.id,{expectedVersion:current.version,classState:'N',actualStart:'2026-11-03T13:01:00Z'}));
    expect(executed.effectiveMonitorId).toBe(substituteId);
    const coverage=await fixture.client().sessionCoverage.findFirstOrThrow({where:{recordId:record.id,kind:'MONITOR'}});
    await run(()=>journal.resolve(fixture.principals.admin,coverage.id,{expectedVersion:executed.version,status:'REVOKED',reason:'Rectificación sin borrar la ejecución'}));
    expect((await fixture.client().classSessionRecord.findUniqueOrThrow({where:{id:record.id}})).effectiveMonitorId).toBe(substituteId);
  });
  it('LISTEN entre dos instancias: solo commit; reconexión señaliza resincronización',async()=>{
    const other=new OperationsService(contexts,records,{} as RequestDocuments);
    await operations.onModuleInit(); await other.onModuleInit();
    const wait=(predicate:(event:{schema:string;resync?:boolean;transportDown?:boolean})=>boolean)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{subscription.unsubscribe();reject(new Error('No llegó la señal'));},10000); const subscription=other.changes.subscribe(event=>{if(predicate(event)){clearTimeout(timer);subscription.unsubscribe();resolve();}});});
    try {
      const committed=wait(event=>event.schema===fixture.schema);
      await fixture.pg.query(`SELECT pg_notify('operations_changed',$1)`,[JSON.stringify({schema:fixture.schema})]);
      await committed;
      let rollbackSignals=0; const subscription=other.changes.subscribe(event=>{if(event.schema===fixture.otherSchema) rollbackSignals++;});
      await fixture.pg.query('BEGIN'); await fixture.pg.query(`SELECT pg_notify('operations_changed',$1)`,[JSON.stringify({schema:fixture.otherSchema})]); await fixture.pg.query('ROLLBACK');
      await new Promise(resolve=>setTimeout(resolve,100)); subscription.unsubscribe(); expect(rollbackSignals).toBe(0);
      const resync=wait(event=>!!event.resync && !event.transportDown);
      await (other as unknown as {listener:Client}).listener.end();
      await resync;
    } finally { await other.onModuleDestroy(); await operations.onModuleDestroy(); }
  });
});
