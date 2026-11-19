import { SessionFilesFixture } from './helpers/session-files-fixtures';
import { installPartTestClock } from './helpers/part-test-clock';
import { ClassSessionRecordsService } from '../src/modules/class-session-records/class-session-records.service';
import { SessionJournalService } from '../src/modules/class-session-records/session-journal.service';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('Generación semanal de partes', () => {
  const fixture = new SessionFilesFixture();
  let journal: SessionJournalService;
  let records: ClassSessionRecordsService;
  let clock: Awaited<ReturnType<typeof installPartTestClock>>;
  beforeAll(async () => {
    await fixture.initialize();
    clock=await installPartTestClock(fixture.client(), fixture.schema);
    await clock.set(new Date('2026-11-15T18:00:00Z'),0);
    const db = fixture.client();
    const monitor=await db.monitor.create({data:{userId:fixture.principals.monitor.userId,supervisorId:fixture.supervisorId}});
    await db.class.update({where:{id:fixture.classId},data:{monitorId:monitor.id}});
    await db.shift.update({where:{id:1},data:{endTime:new Date('1970-01-01T08:40Z')}});
    await db.sessionOperationalConfig.update({where:{id:1},data:{enabled:true,startsOn:new Date('2026-11-01'),endsOn:new Date('2026-12-31')}});
    await db.schedule.createMany({data: (['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'] as const).map(weekday=>({classId:fixture.classId,courseId:1,hourSessionId:1,weekday}))});
    records = new ClassSessionRecordsService(fixture.apiPrisma as unknown as PrismaService,fixture.context,{assertAvailable:async()=>undefined} as unknown as SchemaManagerService);
    journal = new SessionJournalService(records);
  },60000);
  afterAll(()=>fixture.close());

  it('en domingo genera lunes a sábado sin abrir anticipadamente ni completar horas reales', async () => {
    const result=await journal.materializeWeek(fixture.client(),fixture.schema);
    expect(result.from).toBe('2026-11-16');expect(result.to).toBe('2026-11-21');expect(result.created).toBe(6);
    const rows=await fixture.client().classSessionRecord.findMany({orderBy:{date:'asc'}});
    expect(rows).toHaveLength(6);
    expect(rows.every(r=>r.actualStart===null&&r.actualEnd===null&&r.editOpensAt!>new Date('2026-11-15T18:00:00Z'))).toBe(true);
    expect(rows[0].editOpensAt?.toISOString()).toBe('2026-11-16T12:55:00.000Z');
    expect(rows[0].editDeadline.toISOString()).toBe('2026-11-16T15:10:00.000Z');
  });
  it('repetir conserva IDs, snapshots y versiones; no duplica ni reconstruye historia', async()=>{
    const before=await fixture.client().classSessionRecord.findMany({orderBy:{id:'asc'}});
    expect((await journal.materializeWeek(fixture.client(),fixture.schema)).created).toBe(0);
    expect(await fixture.client().classSessionRecord.findMany({orderBy:{id:'asc'}})).toEqual(before);
    await expect(journal.materialize(fixture.client(),fixture.schema,'2026-11-14')).rejects.toThrow('Solo se materializa');
  });
  it('el monitor abre su última jornada el domingo y el lunes abre la actual, con edición solo en plazo',async()=>{
    await fixture.client().classSessionRecord.create({data:{date:new Date('2026-11-14'),classId:fixture.classId,hourSessionId:1,shiftId:1,areaId:1,courseId:1,period:1,pedagogicalMinutes:40,monitorAccountId:fixture.principals.monitor.userId,supervisorId:fixture.supervisorId,snapshot:{},timingPolicy:{},scheduledStart:new Date('2026-11-14T13:00Z'),scheduledEnd:new Date('2026-11-14T13:40Z'),shiftEnd:new Date('2026-11-14T13:40Z'),editOpensAt:new Date('2026-11-14T12:55Z'),editDeadline:new Date('2026-11-14T15:10Z')}});
    const workspace=()=>fixture.context.run({schema:fixture.schema,routing:{adminSchema:fixture.schema,userSchema:fixture.schema}},()=>records.workspace(fixture.principals.monitor,{}));
    const sunday=await workspace();expect(sunday.selection.date).toBe('2026-11-14');expect(sunday.rows).toHaveLength(1);expect(sunday.rows[0].policy.canEdit).toBe(false);
    await clock.set(new Date('2026-11-16T13:00Z'),0);
    const monday=await workspace();expect(monday.selection.date).toBe('2026-11-16');expect(monday.rows[0].policy.canEdit).toBe(true);
    await clock.set(new Date('2026-11-16T15:10Z'),0);expect((await workspace()).rows[0].policy.canEdit).toBe(false);
  });
  it('lista partes sin fechas y mantiene el alcance del supervisor',async()=>{
    const run=(role:string)=>fixture.context.run({schema:fixture.schema,routing:{adminSchema:fixture.schema,userSchema:fixture.schema}},()=>records.journals(fixture.principals[role],{page:1,limit:25,classId:fixture.classId}));
    expect((await run('supervisor')).total).toBe(7);
    expect((await run('otherSupervisor')).total).toBe(0);
    expect((await run('admin')).total).toBe(7);
    const byShift=(shiftId:number)=>fixture.context.run({schema:fixture.schema,routing:{adminSchema:fixture.schema,userSchema:fixture.schema}},()=>records.journals(fixture.principals.admin,{page:1,limit:25,classId:fixture.classId,shiftId}));
    expect((await byShift(1)).total).toBe(7);
    expect((await byShift(999)).total).toBe(0);
  });
});
