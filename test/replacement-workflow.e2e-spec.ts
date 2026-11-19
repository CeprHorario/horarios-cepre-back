import {Prisma} from '../src/generated/prisma/client';
import {SessionJournalService} from '../src/modules/class-session-records/session-journal.service';
import {installPartTestClock} from './helpers/part-test-clock';
import {applyApprovedReplacements} from '../src/modules/operations/apply-approved-replacements';
import {randomUUID} from 'node:crypto';
import {ConfigService} from '@nestjs/config';
import JSZip from 'jszip';
import {SessionFilesFixture,pngFixture} from './helpers/session-files-fixtures';
import {OperationsService,type ReplacementRequest} from '../src/modules/operations/operations.service';
import {OperationsContext} from '../src/modules/operations/operations-context.service';
import {ClassSessionRecordsService} from '../src/modules/class-session-records/class-session-records.service';
import {RequestDocuments} from '../src/modules/operations/request-document.service';
import {SchemaManagerService} from '../src/database/schema-manager/schema-manger.service';
import {PrismaService} from '../src/database/prisma/prisma.service';
import type {SessionPrincipal} from '../src/modules/class-session-records/session.types';
import type {ReplacementDraftDto} from '../src/modules/operations/operations.dto';

const suite=process.env.TEST_DATABASE_URL?describe:describe.skip;
suite('Circuito de reemplazos con permiso final del administrador',()=>{
 const f=new SessionFilesFixture();let records:ClassSessionRecordsService,journal:SessionJournalService,clock:Awaited<ReturnType<typeof installPartTestClock>>;let service:OperationsService,date:string,alternateDate:string,weekday:'Lunes'|'Martes'|'Miercoles'|'Jueves'|'Viernes'|'Sabado';
 let monitorId:string,replacementMonitorId:string,teacherId:string,teacherReplacement:SessionPrincipal,coordinator:SessionPrincipal,otherCoordinator:SessionPrincipal,sameShift:SessionPrincipal,extraMonitor:SessionPrincipal,extraClass:string;
 let monitorRequest:ReplacementRequest,teacherRequest:ReplacementRequest;
 const db=()=>f.client();
 const run=<T>(p:SessionPrincipal,work:(p:SessionPrincipal)=>Promise<T>)=>f.context.run({schema:f.schema,routing:{adminSchema:f.schema,userSchema:f.schema}},()=>work(p));
 const evidence=()=>{const buffer=pngFixture();return [{buffer,size:buffer.length,originalname:'evidencia.png',mimetype:'image/png'} as Express.Multer.File];};
 const draft=(replacement:string,patch:Partial<ReplacementDraftDto>={}):ReplacementDraftDto=>({operationId:randomUUID(),date,kind:'NORMAL',classId:f.classId,hourSessionIds:[1,2],replacementUserId:replacement,reason:'Motivo documentado de reemplazo de funciones',compress:true,...patch});
 const create=(p:SessionPrincipal,d:ReplacementDraftDto)=>run(p,p=>service.create(p,d,evidence()));
 const decide=(p:SessionPrincipal,r:ReplacementRequest,status:string)=>run(p,p=>service.decide(p,r.id,{expectedVersion:r.version,status,reason:'Decisión documentada de prueba'}));
 const account=async(name:string,role:string)=>{const user=await db().user.create({data:{email:name+'@test.invalid',role,userProfile:{create:{firstName:name,lastName:'Prueba',dni:String(90000000+Math.floor(Math.random()*999999))}}}});return {userId:user.id,email:user.email,role};};
 beforeAll(async()=>{
  await f.initialize();const future=new Date(Date.now()+7*86400000);while(future.getUTCDay()===0)future.setUTCDate(future.getUTCDate()+1);date=future.toISOString().slice(0,10);alternateDate=new Date(+future+7*86400000).toISOString().slice(0,10);weekday=['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'][future.getUTCDay()] as typeof weekday;
  await f.pg.query("INSERT INTO public.admission_processes(name,year,is_current,started,finished,structure_version) VALUES($1,2027,false,$2::date-7,$2::date+30,'test')",[f.schema,date]);
  await f.pg.query('INSERT INTO core_schema.users(id,email,role) VALUES($1,$2,$3)',[f.principals.admin.userId,f.principals.admin.email,'administrador']);
  await db().shift.update({where:{id:1},data:{startTime:new Date('1970-01-01T08:00Z'),endTime:new Date('1970-01-01T09:25Z')}});
  await db().shift.create({data:{id:2,name:'Turno 02',startTime:new Date('1970-01-01T16:00Z'),endTime:new Date('1970-01-01T17:25Z')}});
  await db().hourSession.create({data:{id:2,shiftId:1,period:2,startTime:new Date('1970-01-01T08:45Z'),endTime:new Date('1970-01-01T09:25Z')}});
  await db().supervisor.update({where:{id:f.supervisorId},data:{shiftId:1}});
  await db().supervisor.update({where:{userId:f.principals.otherSupervisor.userId},data:{shiftId:2}});
  monitorId=(await db().monitor.create({data:{userId:f.principals.monitor.userId,supervisorId:f.supervisorId}})).id;
  replacementMonitorId=(await db().monitor.create({data:{userId:f.principals.otherMonitor.userId,supervisorId:f.supervisorId}})).id;
  await db().class.update({where:{id:f.classId},data:{monitorId}});
  await db().class.create({data:{name:'Salón candidato otro turno',idSede:1,areaId:1,shiftId:2,monitorId:replacementMonitorId}});
  teacherId=(await db().teacher.create({data:{userId:f.principals.teacher.userId,courseId:1,jobStatus:'FullTime'}})).id;
  teacherReplacement=await account('docente-reemplazante','profesor');const candidate=await db().teacher.create({data:{userId:teacherReplacement.userId,courseId:1,jobStatus:'FreeTime'}});
  await db().teacherAvailability.create({data:{teacherId:candidate.id,weekday,startMinute:0,endMinute:1440}});
  coordinator=await account('coordinador-curso-1','coordinador-1');otherCoordinator=await account('coordinador-curso-2','coordinador-2');
  sameShift=await account('monitor-mismo-turno','monitor');const same=await db().monitor.create({data:{userId:sameShift.userId,supervisorId:f.supervisorId}});
  const owned=await db().class.create({data:{name:'Salón propio mismo turno',idSede:1,areaId:1,shiftId:1,monitorId:same.id}});
  extraMonitor=await account('monitor-otro-salon','monitor');const extra=await db().monitor.create({data:{userId:extraMonitor.userId,supervisorId:f.supervisorId}});
  extraClass=(await db().class.create({data:{name:'Segundo salón solicitado',idSede:1,areaId:1,shiftId:1,monitorId:extra.id}})).id;
  for(const classId of [f.classId,owned.id,extraClass])await db().schedule.createMany({data:[1,2].map(hourSessionId=>({classId,hourSessionId,courseId:1,teacherId:classId===f.classId?teacherId:null,weekday}))});
  for(const hourSessionId of [1,2])await db().classSessionRecord.create({data:{date:new Date(date),classId:f.classId,hourSessionId,shiftId:1,areaId:1,courseId:1,period:hourSessionId,pedagogicalMinutes:40,scheduledStart:new Date(date+(hourSessionId===1?'T08:00:00-05:00':'T08:45:00-05:00')),scheduledEnd:new Date(date+(hourSessionId===1?'T08:40:00-05:00':'T09:25:00-05:00')),shiftEnd:new Date(date+'T09:25:00-05:00'),editDeadline:new Date(date+'T10:55:00-05:00'),titularMonitorId:monitorId,monitorAccountId:f.principals.monitor.userId,titularTeacherId:teacherId,supervisorId:f.supervisorId,snapshot:{className:'Salón prueba',monitor:{name:'Monitor titular'}},timingPolicy:{}}});
  const schemas={assertAvailable:async()=>undefined} as unknown as SchemaManagerService;
  records=new ClassSessionRecordsService(f.apiPrisma as unknown as PrismaService,f.context,schemas);
  const endpoint=process.env.STORAGE_EMULATOR_HOST!;const bucket='workflow-'+randomUUID();const response=await fetch(endpoint+'/storage/v1/b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:bucket})});if(!response.ok)throw Error('No se creó bucket sintético');
  const documents=new RequestDocuments(new ConfigService({GOOGLE_CLOUD_PROJECT:'cepr-local',STORAGE_EMULATOR_HOST:endpoint,GCS_BUCKET:bucket}));
  journal=new SessionJournalService(records);
  clock=await installPartTestClock(db(),f.schema);
  service=new OperationsService(new OperationsContext(f.apiPrisma as unknown as PrismaService,f.context,schemas),records,documents);
 },120000);
 afterAll(async()=>{await f.pg.query('DELETE FROM public.operation_notifications WHERE process_schema=$1',[f.schema]);await f.pg.query('DELETE FROM public.admission_processes WHERE name=$1',[f.schema]);await f.pg.query('DELETE FROM core_schema.users WHERE id=$1',[f.principals.admin?.userId]);await f.close();});

 it('monitor → supervisor → admin: no aplica antes del permiso final y conserva la cuenta del salón',async()=>{
  monitorRequest=await create(f.principals.monitor,draft(f.principals.otherMonitor.userId));expect(monitorRequest.status).toBe('PENDING');
  await expect(decide(f.principals.admin,monitorRequest,'APPROVED')).rejects.toMatchObject({status:403});
  monitorRequest=await decide(f.principals.supervisor,monitorRequest,'APPROVED');expect(monitorRequest.status).toBe('ADMIN_PENDING');expect(await db().sessionCoverage.count()).toBe(0);
  monitorRequest=await decide(f.principals.admin,monitorRequest,'APPROVED');expect(monitorRequest.status).toBe('APPROVED');
  expect(await db().sessionCoverage.count({where:{monitorId:replacementMonitorId,status:'AUTHORIZED'}})).toBe(2);
  expect((await db().classSessionRecord.findMany()).every(r=>r.monitorAccountId===f.principals.monitor.userId)).toBe(true);
  const notices=await f.pg.query('SELECT recipient_id,kind FROM public.operation_notifications WHERE process_schema=$1',[f.schema]);expect(notices.rows.some(n=>n.recipient_id===f.principals.admin.userId&&n.kind==='REPLACEMENT_REVIEW_APPROVED')).toBe(true);
 });
 it('genera Word institucional, fechas separadas, datos, firma y anexos privados',async()=>{
  const word=await run(f.principals.monitor,p=>service.word(p,monitorRequest.id));const zip=await JSZip.loadAsync(word);const xml=await zip.file('word/document.xml')!.async('string');expect(xml).toContain('Dr. Arnaldo Valdivia Loaiza');expect(xml).toContain('monitor(a) del');expect(xml).toContain(date.split('-').reverse().join('/'));expect(xml).toContain('DNI N°');expect(xml).toContain('________________________________');expect(Object.keys(zip.files).some(n=>n==='word/media/image1.png')).toBe(true);expect(xml).toContain('replacementEvidence0');
  const pdf=await run(f.principals.monitor,p=>service.pdf(p,monitorRequest.id));expect(pdf.subarray(0,5).toString()).toBe('%PDF-');
  await expect(run(f.principals.otherSupervisor,p=>service.word(p,monitorRequest.id))).rejects.toMatchObject({status:404});
 });
 it('cancelación conserva el permiso hasta supervisor → admin y revoca sin borrar historia',async()=>{
  monitorRequest=await decide(f.principals.monitor,monitorRequest,'REQUEST_CANCEL');expect(monitorRequest.status).toBe('APPROVED');expect(monitorRequest.cancellation_stage).toBe('REVIEW');
  monitorRequest=await decide(f.principals.supervisor,monitorRequest,'APPROVE_CANCEL');expect(monitorRequest.cancellation_stage).toBe('ADMIN');expect(await db().sessionCoverage.count({where:{status:'AUTHORIZED'}})).toBe(2);
  monitorRequest=await decide(f.principals.admin,monitorRequest,'APPROVE_CANCEL');expect(monitorRequest.status).toBe('CANCELLED');expect(await db().sessionCoverage.count({where:{status:'REVOKED'}})).toBe(2);expect(await db().classSessionRecord.count()).toBe(2);
 });
 it('devolver permite reenviar un documento nuevo, conserva el original y permite rechazo definitivo',async()=>{
  let original=await create(f.principals.monitor,draft(f.principals.otherMonitor.userId));original=await decide(f.principals.supervisor,original,'CHANGES');expect(original.status).toBe('CHANGES');
  const revised=await create(f.principals.monitor,draft(f.principals.otherMonitor.userId,{revisesId:original.id,reason:'Motivo corregido con todos los datos solicitados'}));expect(revised.id).not.toBe(original.id);expect(revised.status).toBe('PENDING');expect((await run(f.principals.monitor,p=>service.detail(p,original.id))).status).toBe('SUPERSEDED');
  expect((await run(f.principals.monitor,p=>service.pdf(p,original.id))).length).toBeGreaterThan(0);
  expect((await decide(f.principals.supervisor,revised,'REJECTED')).status).toBe('REJECTED');
 });
 it('docente → coordinador de su curso → admin; solo el aprobado aparece al reemplazante',async()=>{
  teacherRequest=await create(f.principals.teacher,draft(teacherReplacement.userId));expect(teacherRequest.status).toBe('PENDING');
  const query={from:date,to:alternateDate,page:1,limit:20};expect((await run(teacherReplacement,p=>service.teachingReplacements(p,query))).total).toBe(0);
  expect((await run(coordinator,p=>service.list(p,{page:1,limit:20}))).data.some(r=>r.id===teacherRequest.id)).toBe(true);
  expect((await run(otherCoordinator,p=>service.list(p,{page:1,limit:20}))).data.some(r=>r.id===teacherRequest.id)).toBe(false);
  await expect(decide(f.principals.admin,teacherRequest,'APPROVED')).rejects.toMatchObject({status:403});
  teacherRequest=await decide(coordinator,teacherRequest,'APPROVED');expect(teacherRequest.status).toBe('ADMIN_PENDING');teacherRequest=await decide(f.principals.admin,teacherRequest,'APPROVED');
  expect((await run(teacherReplacement,p=>service.teachingReplacements(p,query))).total).toBe(1);
 });
 it('supervisor y coordinador van directo al admin y son documentales',async()=>{
  const before=await db().classSessionRecord.findMany({orderBy:{id:'asc'}});
  let sup=await create(f.principals.supervisor,draft(f.principals.otherSupervisor.userId,{classId:undefined}));expect(sup.status).toBe('ADMIN_PENDING');sup=await decide(f.principals.admin,sup,'APPROVED');expect(sup.status).toBe('APPROVED');
  let coord=await create(coordinator,draft(otherCoordinator.userId));expect(coord.status).toBe('ADMIN_PENDING');coord=await decide(f.principals.admin,coord,'APPROVED');expect(coord.status).toBe('APPROVED');
  expect(await db().classSessionRecord.findMany({orderBy:{id:'asc'}})).toEqual(before);
 });
 it('admin puede devolver; cancelar admite corrección y rechazo sin cerrar el permiso original',async()=>{
  let request=await create(f.principals.teacher,draft(teacherReplacement.userId,{date:alternateDate}));
  request=await decide(coordinator,request,'APPROVED');request=await decide(f.principals.admin,request,'CHANGES');expect(request.status).toBe('CHANGES');
  request=await decide(f.principals.teacher,request,'REQUEST_CANCEL');request=await decide(coordinator,request,'CHANGES');expect(request.cancellation_stage).toBe('CHANGES');
  request=await decide(f.principals.teacher,request,'REQUEST_CANCEL');request=await decide(coordinator,request,'APPROVE_CANCEL');request=await decide(f.principals.admin,request,'REJECT_CANCEL');expect(request.status).toBe('CHANGES');expect(request.cancellation_stage).toBeNull();
  request=await decide(f.principals.teacher,request,'REQUEST_CANCEL');request=await decide(coordinator,request,'APPROVE_CANCEL');request=await decide(f.principals.admin,request,'APPROVE_CANCEL');expect(request.status).toBe('CANCELLED');
 });
 it('mismo turno exige declaración y un monitor no puede reemplazar otro salón en esa jornada',async()=>{
  const q={date:alternateDate,classId:f.classId,kind:'NORMAL' as const,hours:'1',page:1};expect((await run(f.principals.monitor,p=>service.candidates(p,q))).data.some(c=>c.id===sameShift.userId)).toBe(false);
  expect((await run(f.principals.monitor,p=>service.candidates(p,{...q,sameTurn:true}))).data.some(c=>c.id===sameShift.userId)).toBe(true);
  await expect(create(f.principals.monitor,draft(sameShift.userId,{date:alternateDate,sameTurn:true}))).rejects.toMatchObject({status:400});
  let first=await create(f.principals.monitor,draft(sameShift.userId,{date:alternateDate,hourSessionIds:[1],sameTurn:true,sameTurnReason:'No encontré un monitor dispuesto de otro turno'}));first=await decide(f.principals.supervisor,first,'APPROVED');await decide(f.principals.admin,first,'APPROVED');
  const other={...q,classId:extraClass,hours:'2',sameTurn:true};expect((await run(extraMonitor,p=>service.candidates(p,other))).data.some(c=>c.id===sameShift.userId)).toBe(false);
 });
 it('coordinador general lee todas las solicitudes y documentos sin poder aprobar',async()=>{
  const general=f.principals.coordinator;
  expect((await run(general,p=>service.context(p))).role).toBe('coordinador');
  const list=await run(general,p=>service.list(p,{page:1,limit:100}));
  expect(list.data.some(r=>r.id===monitorRequest.id)).toBe(true);
  expect(list.data.some(r=>r.id===teacherRequest.id)).toBe(true);
  expect((await run(general,p=>service.word(p,teacherRequest.id))).length).toBeGreaterThan(0);
  await expect(decide(general,teacherRequest,'APPROVED')).rejects.toMatchObject({status:403});
 });
 it('previsualiza sin escribir y aprueba una reserva antes de existir su semana; generación idempotente',async()=>{
  const future=new Date(date);future.setUTCDate(future.getUTCDate()+14);const day=future.toISOString().slice(0,10);
  const input=draft(teacherReplacement.userId,{date:day});const before=await db().$queryRaw<{count:number}[]>`SELECT count(*)::int count FROM replacement_requests`;
  const preview=await run(f.principals.teacher,p=>service.create(p,input,evidence(),true));expect(preview.subarray(0,5).toString()).toBe('%PDF-');
  expect(await db().$queryRaw`SELECT count(*)::int count FROM replacement_requests`).toEqual(before);
  let request=await create(f.principals.teacher,input);request=await decide(coordinator,request,'APPROVED');request=await run(f.principals.admin,p=>service.decide(p,request.id,{expectedVersion:request.version,status:'APPROVED'}));
  expect(await db().classSessionRecord.count({where:{date:new Date(day)}})).toBe(0);
  expect((await run(teacherReplacement,p=>service.teachingReplacements(p,{from:day,to:day,page:1,limit:20}))).total).toBe(1);
  await db().sessionOperationalConfig.update({where:{id:1},data:{enabled:true,startsOn:new Date('2026-01-01'),endsOn:new Date('2027-12-31'),latenessToleranceMinutes:3}});
  await clock.set(new Date(day+'T13:10Z'),0);await journal.materializeWeek(db(),f.schema);
  const rows=await db().classSessionRecord.findMany({where:{date:new Date(day),classId:f.classId},orderBy:{period:'asc'}});
  expect(rows).toHaveLength(2);expect(rows.every(r=>r.classState==='RN')).toBe(true);expect(rows.every(r=>r.effectiveTeacherId!==teacherId)).toBe(true);
  expect(JSON.stringify(rows[0].effectiveSnapshot)).toContain('docente-reemplazante');expect(rows[0].actualStart).toBeNull();
  await journal.materializeWeek(db(),f.schema);expect((await db().classSessionRecord.findUniqueOrThrow({where:{id:rows[0].id}})).version).toBe(rows[0].version);
 });
 it('RN provisional recibe documento posterior y conserva horas/observaciones al aprobar',async()=>{
  await db().userProfile.upsert({where:{userId:f.principals.teacher.userId},create:{userId:f.principals.teacher.userId,firstName:'Docente',lastName:'Titular',dni:'98000001'},update:{dni:'98000001'}});
  await clock.set(new Date(alternateDate+'T13:10Z'),0);await journal.materializeWeek(db(),f.schema);
  let row=await db().classSessionRecord.findFirstOrThrow({where:{date:new Date(alternateDate),classId:f.classId,period:1}});
  row=await run(f.principals.monitor,p=>records.update(p,row.id,{expectedVersion:row.version,classState:'RN',replacementEmail:teacherReplacement.email,operationId:randomUUID()}));
  expect(row.classState).toBe('RN');expect(row.effectiveTeacherId).not.toBe(teacherId);
  const cv=await db().sessionCoverage.findFirstOrThrow({where:{recordId:row.id,kind:'TEACHER'}});expect(cv.status).toBe('PENDING');
  row=await run(f.principals.monitor,p=>records.update(p,row.id,{expectedVersion:row.version,actualStart:alternateDate+'T13:06:00Z'}));
  expect(row.classState).toBe('RN');expect(JSON.stringify(row.structuredObservations)).toContain('Ingreso tardío del docente reemplazante');
  const pending=await run(f.principals.teacher,p=>service.pendingDocuments(p)) as {operationId:string}[];expect(pending.some(c=>c.operationId===cv.operationId)).toBe(true);
  let request=await create(f.principals.teacher,draft(teacherReplacement.userId,{date:alternateDate,hourSessionIds:[1],coverageOperationId:cv.operationId!}));
  request=await decide(coordinator,request,'APPROVED');request=await decide(f.principals.admin,request,'APPROVED');
  expect((await db().sessionCoverage.findUniqueOrThrow({where:{id:cv.id}})).status).toBe('AUTHORIZED');
  const saved=await db().classSessionRecord.findUniqueOrThrow({where:{id:row.id}});expect(saved.actualStart).toEqual(row.actualStart);expect(saved.classState).toBe('RN');
  await expect(run(f.principals.monitor,p=>records.update(p,row.id,{expectedVersion:row.version,actualStart:alternateDate+'T12:59:00Z'}))).rejects.toMatchObject({status:400});
 });
 it('supervisor registra emergencia docente en dos bloques y monitor sustituto, con documento pendiente',async()=>{
  const base=await db().classSessionRecord.findFirstOrThrow({where:{date:new Date(alternateDate),classId:f.classId,period:1}});
  const ids:number[]=[];
  for(const period of [3,4]){
    const start=period===3?'09:30':'10:15',end=period===3?'10:10':'10:55';
    await db().hourSession.create({data:{id:period,shiftId:1,period,startTime:new Date('1970-01-01T'+start+'Z'),endTime:new Date('1970-01-01T'+end+'Z')}});
    const {id:_id,...data}=base;const row=await db().classSessionRecord.create({data:{...data,initialAssociatedBy:Prisma.DbNull,finalAssociatedBy:Prisma.DbNull,deletedBy:Prisma.DbNull,hourSessionId:period,period,version:1,actualStart:null,actualEnd:null,classState:null,effectiveTeacherId:null,effectiveMonitorId:null,snapshot:{className:'Salón prueba',course:'Course'},effectiveSnapshot:{},structuredObservations:[],timingPolicy:{latenessToleranceMinutes:3,breakMinutes:5},scheduledStart:new Date(alternateDate+'T'+start+':00-05:00'),scheduledEnd:new Date(alternateDate+'T'+end+':00-05:00'),shiftEnd:new Date(alternateDate+'T10:55:00-05:00'),editDeadline:new Date(alternateDate+'T12:25:00-05:00')}});ids.push(row.id);
  }
  const person=await db().teacher.findUniqueOrThrow({where:{userId:teacherReplacement.userId}});
  await run(f.principals.supervisor,p=>journal.cover(p,{targets:ids.map(recordId=>({recordId,expectedVersion:1})),kind:'TEACHER',personId:person.id,mode:'EMERGENCY',reason:'Docente titular no pudo ingresar'}));
  let rows=await db().classSessionRecord.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}});expect(rows.every(r=>r.classState==='RE'&&r.actualStart?.getTime()===r.scheduledStart.getTime()&&r.actualEnd?.getTime()===r.scheduledEnd.getTime())).toBe(true);
  await run(f.principals.supervisor,p=>journal.cover(p,{targets:rows.map(r=>({recordId:r.id,expectedVersion:r.version})),kind:'MONITOR',personId:replacementMonitorId,mode:'EMERGENCY',reason:'Monitor original no pudo ingresar'}));
  rows=await db().classSessionRecord.findMany({where:{id:{in:ids}}});expect(rows.every(r=>r.effectiveMonitorId===replacementMonitorId&&r.monitorAccountId===f.principals.monitor.userId)).toBe(true);
  expect((await run(f.principals.monitor,p=>service.pendingDocuments(p)) as unknown[]).length).toBeGreaterThan(0);
 });
 it('el cambio de horario deja el permiso sin aplicar y avisa, sin trasladar coberturas',async()=>{
  const future=new Date(date);future.setUTCDate(future.getUTCDate()+21);const day=future.toISOString().slice(0,10);
  let request=await create(f.principals.teacher,draft(teacherReplacement.userId,{date:day,hourSessionIds:[1,2]}));request=await decide(coordinator,request,'APPROVED');request=await decide(f.principals.admin,request,'APPROVED');
  await db().hourSession.update({where:{id:1},data:{startTime:new Date('1970-01-01T08:05Z')}});
  await clock.set(new Date(day+'T13:10Z'),0);await journal.materializeWeek(db(),f.schema);
  expect(await db().$queryRaw`SELECT request_id FROM replacement_application_issues WHERE request_id=${request.id}::uuid`).toHaveLength(1);
  expect(await db().sessionCoverage.count({where:{operationId:request.id}})).toBe(0);
  await records.transaction(db(),f.schema,tx=>applyApprovedReplacements(tx));
  expect(await db().sessionCoverage.count({where:{operationId:request.id}})).toBe(0);
 });
});
