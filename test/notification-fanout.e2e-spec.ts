import { SessionFilesFixture } from './helpers/session-files-fixtures';
import { ClassSessionRecordsService } from '../src/modules/class-session-records/class-session-records.service';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { Role } from '../src/modules/auth/decorators/authorization.decorator';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite(
  'Notificaciones de reemplazo sin titular y con muchos destinatarios',
  () => {
    const fixture = new SessionFilesFixture();
    beforeAll(() => fixture.initialize(), 60000);
    afterAll(async () => {
      await fixture.pg.query(
        'DELETE FROM public.operation_notifications WHERE process_schema=$1',
        [fixture.schema],
      );
      await fixture.close();
    });

    it('confirma la transacción y avisa a todos los candidatos aunque el titular sea nulo', async () => {
      const db = fixture.client();
      const record = await fixture.record();
      expect(record.titularTeacherId).toBeNull();
      const service = new ClassSessionRecordsService(
        fixture.apiPrisma as unknown as PrismaService,
        fixture.context,
        {} as SchemaManagerService,
      );
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL search_path TO "${fixture.schema}",public`,
        );
        await tx.$executeRaw`INSERT INTO users(email,role) SELECT 'fanout-'||g||'@test.invalid','profesor' FROM generate_series(1,140) g`;
        await tx.$executeRaw`INSERT INTO teachers(user_id,course_id,max_hours,job_status) SELECT id,1,40,'PART_TIME' FROM users WHERE email LIKE 'fanout-%@test.invalid'`;
        await tx.$executeRaw`INSERT INTO teacher_availabilities(teacher_id,weekday,start_minute,end_minute) SELECT t.id,day,0,1440 FROM teachers t CROSS JOIN unnest(enum_range(NULL::"Weekday")) day`;
        const recipients = await service.notifyCoverage(
          tx,
          fixture.schema,
          record,
          { id: 991, status: 'PENDING', kind: 'TEACHER', requestedBy: null },
          'PROPOSED',
          {
            id: fixture.principals.monitor.userId,
            email: fixture.principals.monitor.email,
            role: Role.MONITOR,
            origin: fixture.schema,
            schema: fixture.schema,
          },
        );
        expect(recipients.length).toBeGreaterThanOrEqual(140);
      });
      const result = await fixture.pg.query(
        'SELECT count(*)::int total FROM public.operation_notifications n JOIN "' +
          fixture.schema +
          '".users u ON u.id=n.recipient_id WHERE n.process_schema=$1 AND u.email LIKE $2',
        [fixture.schema, 'fanout-%@test.invalid'],
      );
      expect(result.rows[0].total).toBe(140);
    });
  },
);
