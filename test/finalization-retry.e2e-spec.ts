import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { ClassSessionRecordsService } from '../src/modules/class-session-records/class-session-records.service';
import { installPartTestClock } from './helpers/part-test-clock';
import { SessionFilesFixture } from './helpers/session-files-fixtures';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('V06 suplemento RN/RE en ventana controlada', () => {
  const fixture = new SessionFilesFixture();
  const schemas = { assertAvailable: async () => {} } as unknown as SchemaManagerService;
  const records = new ClassSessionRecordsService(fixture.apiPrisma as unknown as PrismaService, fixture.context, schemas);
  let clock: Awaited<ReturnType<typeof installPartTestClock>>;
  beforeAll(async () => {
    await fixture.initialize();
    const db = fixture.client();
    const monitor = await db.monitor.create({ data: { userId: fixture.principals.monitor.userId, supervisorId: fixture.supervisorId } });
    await db.class.update({ where: { id: fixture.classId }, data: { monitorId: monitor.id } });
    const user = await db.user.create({ data: { email: 'retry-finalization@test.invalid', role: 'profesor' } });
    const candidate = await db.teacher.create({ data: { userId: user.id, courseId: 1, jobStatus: 'PartTime' } });
    await db.teacherAvailability.create({ data: { teacherId: candidate.id, weekday: 'Martes', startMinute: 0, endMinute: 1440 } });
    clock = await installPartTestClock(db, fixture.schema);
  });
  afterAll(async () => { await fixture.close(); });
  it.each(['RN', 'RE'])('%s reintenta mismo identificador y payload sin duplicar cobertura', async classState => {
    await clock.set(new Date('2026-11-03T13:10Z'), 0);
    const db = fixture.client();
    const period = classState === 'RN' ? 41 : 42;
    const hour = await db.hourSession.create({ data: { id: period, period, shiftId: 1, startTime: new Date('1970-01-01T08:00Z'), endTime: new Date('1970-01-01T08:40Z') } });
    const record = await db.classSessionRecord.create({ data: { date: new Date('2026-11-03'), classId: fixture.classId, hourSessionId: hour.id, shiftId: 1, areaId: 1, courseId: 1, period, pedagogicalMinutes: 40, scheduledStart: new Date('2026-11-03T13:00Z'), scheduledEnd: new Date('2026-11-03T13:40Z'), shiftEnd: new Date('2026-11-03T13:40Z'), editDeadline: new Date('2026-11-03T15:10Z'), monitorAccountId: fixture.principals.monitor.userId, supervisorId: fixture.supervisorId, snapshot: {}, timingPolicy: {} } });
    const dto = { expectedVersion: record.version, classState, replacementEmail: 'retry-finalization@test.invalid', operationId: randomUUID() };
    const run = () => fixture.context.run({ schema: fixture.schema, routing: { adminSchema: fixture.schema, userSchema: fixture.schema } }, () => records.update(fixture.principals.monitor, record.id, dto));
    const first = await run();
    const repeated = await run();
    expect(repeated.version).toBe(first.version);
    expect(repeated.coverages.map(item => item.id)).toEqual(first.coverages.map(item => item.id));
    expect(await db.sessionCoverage.count({ where: { recordId: record.id } })).toBe(1);
    expect(first.teachingStatus).toBe('UNCONFIRMED');
    expect(first.effectiveTeacherId).toBeNull();
  });
});
