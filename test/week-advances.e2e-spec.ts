import { SessionFilesFixture } from './helpers/session-files-fixtures';
import { installPartTestClock } from './helpers/part-test-clock';
import { ClassSessionRecordsService } from '../src/modules/class-session-records/class-session-records.service';
import { SessionJournalService } from '../src/modules/class-session-records/session-journal.service';
import { SessionReportsService } from '../src/modules/class-session-records/session-reports.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { OperationsContext } from '../src/modules/operations/operations-context.service';
import { OperationsService } from '../src/modules/operations/operations.service';
import { RequestDocuments } from '../src/modules/operations/request-document.service';

const suite=process.env.TEST_DATABASE_URL?describe:describe.skip;
suite('Adelanto de un día académico al domingo previo',()=>{
 const f=new SessionFilesFixture();let journal:SessionJournalService,records:ClassSessionRecordsService,operations:OperationsService;
 let clock:Awaited<ReturnType<typeof installPartTestClock>>;
 const schemas={assertAvailable:async()=>undefined} as unknown as SchemaManagerService;
 const run=<T>(_role:string,work:()=>Promise<T>)=>f.context.run({schema:f.schema,routing:{adminSchema:f.schema,userSchema:f.schema}},work);
 const plan=()=>run('admin',()=>journal.weeklyPlanning(f.principals.admin));
 const choose=(weekday:number|null,expectedVersion:number)=>run('admin',()=>journal.chooseWeekAdvance(f.principals.admin,{weekStart:'2026-11-23',weekday,expectedVersion}));
 beforeAll(async()=>{
  await f.initialize();clock=await installPartTestClock(f.client(),f.schema);await clock.set(new Date('2026-11-16T18:00Z'),0);
  const db=f.client();await db.shift.update({where:{id:1},data:{startTime:new Date('1970-01-01T16:00Z'),endTime:new Date('1970-01-01T21:10Z')}});
  await db.hourSession.update({where:{id:1},data:{startTime:new Date('1970-01-01T16:00Z'),endTime:new Date('1970-01-01T16:40Z')}});
  await db.hourSession.createMany({data:[{id:2,period:2,shiftId:1,startTime:new Date('1970-01-01T16:45Z'),endTime:new Date('1970-01-01T17:25Z')},{id:3,period:7,shiftId:1,startTime:new Date('1970-01-01T20:30Z'),endTime:new Date('1970-01-01T21:10Z')}]});
  const monitor=await db.monitor.create({data:{userId:f.principals.monitor.userId,supervisorId:f.supervisorId}});
  const teacher=await db.teacher.create({data:{userId:f.principals.teacher.userId,courseId:1,maxHours:40,jobStatus:'FreeTime'}});
  await db.class.update({where:{id:f.classId},data:{monitorId:monitor.id}});
  await db.sessionOperationalConfig.update({where:{id:1},data:{enabled:true,startsOn:new Date('2026-11-01'),endsOn:new Date('2026-12-31')}});
  const days=['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'] as const;
  await db.schedule.createMany({data:days.flatMap(weekday=>[1,2,3].map(hourSessionId=>({weekday,classId:f.classId,courseId:1,hourSessionId,teacherId:teacher.id})))});
  await f.pg.query("INSERT INTO public.admission_processes(name,year,is_current,started,finished,structure_version) VALUES($1,2027,false,'2026-11-01','2026-12-31','test')",[f.schema]);
  records=new ClassSessionRecordsService(f.apiPrisma as unknown as PrismaService,f.context,schemas);journal=new SessionJournalService(records);
  const contexts=new OperationsContext(f.apiPrisma as unknown as PrismaService,f.context,schemas);operations=new OperationsService(contexts,records,{} as RequestDocuments);
 },60000);
 afterAll(async()=>{await f.pg.query('DELETE FROM public.operation_notifications WHERE process_schema=$1',[f.schema]);await f.pg.query('DELETE FROM public.admission_processes WHERE name=$1',[f.schema]);await f.close();});

 it('solo admin decide, y únicamente después de generar la semana actual',async()=>{
  await expect(run('monitor',()=>journal.weeklyPlanning(f.principals.monitor))).rejects.toMatchObject({status:403});
  await expect(run('supervisor',()=>journal.chooseWeekAdvance(f.principals.supervisor,{weekStart:'2026-11-23',weekday:3,expectedVersion:0}))).rejects.toMatchObject({status:403});
  await expect(choose(3,0)).rejects.toMatchObject({status:409});
  expect((await journal.materializeWeek(f.client(),f.schema)).created).toBe(18);
  const info=await plan();expect(info.next).toMatchObject({from:'2026-11-23',sunday:'2026-11-22',canChoose:true,version:0});expect(info.next.cutoff).toBe('2026-11-22T02:10:00.000Z');expect(info.next.days).toHaveLength(6);
 });
 it('selecciona un miércoles, permite cancelarlo y rechaza versiones obsoletas',async()=>{
  expect((await choose(3,0)).next).toMatchObject({weekday:3,version:1});
  await expect(choose(4,0)).rejects.toMatchObject({status:409});
  expect((await choose(null,1)).next.weekday).toBeNull();expect((await choose(3,2)).next.version).toBe(3);
  await expect(run('admin',()=>journal.chooseWeekAdvance(f.principals.admin,{weekStart:'2026-11-30',weekday:3,expectedVersion:0}))).rejects.toMatchObject({status:409});
 });
 it('rechaza un cruce de salón/docente con un horario del domingo sin cambiar la decisión',async()=>{
  await f.client().schedule.create({data:{weekday:'Domingo',classId:f.classId,courseId:1,hourSessionId:1}});
  await expect(choose(4,3)).rejects.toThrow('cruza');expect((await plan()).next.weekday).toBe(3);
  await f.client().schedule.deleteMany({where:{weekday:'Domingo'}});
 });
 it('en el cierre exacto del sábado bloquea decisiones y genera la semana siguiente automáticamente',async()=>{
  await clock.set(new Date('2026-11-22T02:10Z'),0);expect((await plan()).next.canChoose).toBe(false);
  await expect(choose(4,3)).rejects.toMatchObject({status:409});await journal.ensureWeeklyGeneration(f.client(),f.schema);
  const moved=await f.client().classSessionRecord.findMany({where:{academicDate:new Date('2026-11-25')},orderBy:{period:'asc'}});
  expect(moved).toHaveLength(3);expect(moved.every(r=>r.date.toISOString().slice(0,10)==='2026-11-22')).toBe(true);
  expect(moved[0].scheduledStart.toISOString()).toBe('2026-11-22T21:00:00.000Z');expect(moved[0].editOpensAt?.toISOString()).toBe('2026-11-22T20:55:00.000Z');expect(moved[0].editDeadline.toISOString()).toBe('2026-11-23T03:40:00.000Z');
  expect(await f.client().classSessionRecord.count({where:{date:new Date('2026-11-25')}})).toBe(0);
  const notices=await f.pg.query('SELECT count(*)::int total FROM public.operation_notifications WHERE process_schema=$1 AND kind=$2',[f.schema,'part.week.advance']);expect(notices.rows[0].total).toBe(4);
 });
 it('no duplica partes; el monitor ve el domingo y edita solo durante su ejecución real',async()=>{
  const before=await f.client().classSessionRecord.findMany({orderBy:{id:'asc'}});await journal.ensureWeeklyGeneration(f.client(),f.schema);expect(await f.client().classSessionRecord.findMany({orderBy:{id:'asc'}})).toEqual(before);
  await clock.set(new Date('2026-11-22T21:00Z'),0);const sheet=await run('monitor',()=>records.workspace(f.principals.monitor,{}));expect(sheet.selection.date).toBe('2026-11-22');expect(sheet.rows).toHaveLength(3);expect(sheet.rows[0].academicDate?.toISOString().slice(0,10)).toBe('2026-11-25');expect(sheet.rows[0].policy.canEdit).toBe(true);expect(sheet.rows[2].policy.canEdit).toBe(false);
  const report=await run('admin',()=>new SessionReportsService(records).report(f.principals.admin,{from:'2026-11-22',to:'2026-11-22',page:1,limit:25}));expect((report as {data:Record<string,unknown>[]}).data).toHaveLength(3);expect((report as {data:Record<string,unknown>[]}).data[0].academic_date).toEqual(new Date('2026-11-25'));
  await clock.set(new Date('2026-11-23T03:40Z'),0);expect((await run('monitor',()=>records.workspace(f.principals.monitor,{date:'2026-11-22'}))).rows.every(r=>!r.policy.canEdit)).toBe(true);
  await clock.set(new Date('2026-11-25T18:00Z'),0);expect((await journal.materialize(f.client(),f.schema,'2026-11-25')).created).toBe(0);expect(await f.client().classSessionRecord.count()).toBe(before.length);
 });
 it('las solicitudes usan los bloques del día adelantado en el domingo, sin ofrecer la fecha original',async()=>{
  const sunday=await run('teacher',()=>operations.options(f.principals.teacher,{date:'2026-11-22',classId:f.classId,kind:'NORMAL'}));expect(sunday.blocks).toHaveLength(3);expect(sunday.blocks.every(b=>new Date(new Date(b.start).getTime()-5*3600000).toISOString().startsWith('2026-11-22'))).toBe(true);
  const original=await run('teacher',()=>operations.options(f.principals.teacher,{date:'2026-11-25',classId:f.classId,kind:'NORMAL'}));expect(original.blocks).toHaveLength(0);
 });
 it('los candidatos usan disponibilidad del día académico y respetan ocupación del domingo',async()=>{
  const db=f.client();
  const user=await db.user.create({data:{email:'candidate-week@test.invalid',role:'profesor'}});
  const person=await db.teacher.create({data:{userId:user.id,courseId:1,maxHours:40,jobStatus:'FreeTime'}});
  await db.teacherAvailability.create({data:{teacherId:person.id,weekday:'Miercoles',startMinute:960,endMinute:1320}});
  const candidates=()=>run('teacher',()=>operations.candidates(f.principals.teacher,{date:'2026-11-22',classId:f.classId,kind:'NORMAL',hours:'1,2',page:1}));
  expect((await candidates()).data.some(row=>row.id===user.id)).toBe(true);
  await db.schedule.create({data:{weekday:'Domingo',classId:f.classId,courseId:1,hourSessionId:1,teacherId:person.id}});
  try{expect((await candidates()).data.some(row=>row.id===user.id)).toBe(false);}finally{await db.schedule.deleteMany({where:{weekday:'Domingo',teacherId:person.id}});}
 });
 it('revierte toda la semana ante un fallo y no permite reescribir la fecha académica',async()=>{
  await clock.set(new Date('2026-11-23T18:00Z'),0);await run('admin',()=>journal.chooseWeekAdvance(f.principals.admin,{weekStart:'2026-11-30',weekday:4,expectedVersion:0}));
  await clock.set(new Date('2026-11-29T02:10Z'),0);
  await f.pg.query(`CREATE FUNCTION "${f.schema}".fail_advance_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.academic_date IS NOT NULL THEN RAISE EXCEPTION 'FALLO_ADELANTO_TEST'; END IF; RETURN NEW; END $$`);
  await f.pg.query(`CREATE TRIGGER fail_advance_test BEFORE INSERT ON "${f.schema}".class_session_records FOR EACH ROW EXECUTE FUNCTION "${f.schema}".fail_advance_test()`);
  try{await expect(journal.materializeWeek(f.client(),f.schema,undefined,'2026-11-30')).rejects.toThrow('FALLO_ADELANTO_TEST');expect(await f.client().classSessionRecord.count({where:{date:{gte:new Date('2026-11-29')}}})).toBe(0);}finally{await f.pg.query(`DROP TRIGGER fail_advance_test ON "${f.schema}".class_session_records`);await f.pg.query(`DROP FUNCTION "${f.schema}".fail_advance_test()`);}
  const moved=await f.client().classSessionRecord.findFirstOrThrow({where:{academicDate:{not:null}}});await expect(f.client().classSessionRecord.update({where:{id:moved.id},data:{academicDate:new Date('2026-11-26')}})).rejects.toThrow();
 });
});
