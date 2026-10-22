import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { applyStructure } from '../src/database/prisma/structure';
import { RequestContext } from '../src/database/schema-manager/request-context';
import { ScheduleService } from '../src/modules/schedules/schedules.service';
import { TeacherService } from '../src/modules/teachers/teacher.service';
import { Weekday } from '../src/generated/prisma/client';

const suite = process.env.AVAILABILITY_TEST_DATABASE_URL
  ? describe
  : describe.skip;

suite('Disponibilidad persistida y asignaciones en PostgreSQL', () => {
  const schema = `availability_test_${process.pid}_${Date.now()}`;
  const otherSchema = `${schema}_other`;
  const context = new RequestContext();
  let pool: Pool;
  let prisma: PrismaService;
  let service: ScheduleService;
  let teacherId: string;
  let classes: string[];
  let sessionIds: number[];
  const clock = (time: string) => new Date(`1970-01-01T${time}:00.000Z`);
  const run = <T>(operation: () => T) => context.run({ schema }, operation);

  beforeAll(async () => {
    const url = process.env.AVAILABILITY_TEST_DATABASE_URL!;
    pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await applyStructure(db, schema, true);
      await applyStructure(db, otherSchema, true);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: url, DB_POOL_MAX: 2 }),
      context,
    );
    service = new ScheduleService(prisma);
    await run(async () => {
      const client = prisma.getClient();
      const course = await client.course.create({
        data: { name: 'Curso de prueba' },
      });
      const area = await client.area.create({
        data: { name: 'Área de prueba' },
      });
      const sede = await client.sede.create({
        data: { name: 'Sede de prueba' },
      });
      const user = await client.user.create({
        data: { email: 'availability@example.com', role: 'profesor' },
      });
      const teacher = await client.teacher.create({
        data: {
          userId: user.id,
          courseId: course.id,
          maxHours: 20,
          jobStatus: 'PartTime',
        },
      });
      teacherId = teacher.id;
      classes = [];
      sessionIds = [];
      for (const [index, times] of [
        ['07:00', '07:40'],
        ['07:20', '08:00'],
        ['08:00', '08:40'],
      ].entries()) {
        const shift = await client.shift.create({
          data: { name: `Turno ${index}` },
        });
        const session = await client.hourSession.create({
          data: {
            shiftId: shift.id,
            period: 1,
            startTime: clock(times[0]),
            endTime: clock(times[1]),
          },
        });
        const cls = await client.class.create({
          data: {
            name: `Salón ${index}`,
            areaId: area.id,
            idSede: sede.id,
            shiftId: shift.id,
          },
        });
        await client.schedule.create({
          data: {
            classId: cls.id,
            courseId: course.id,
            hourSessionId: session.id,
            weekday: 'Lunes',
          },
        });
        classes.push(cls.id);
        sessionIds.push(session.id);
      }
    });
  }, 60000);

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    if (pool) {
      // Only the two schemas created by this suite are removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.query(`DROP SCHEMA IF EXISTS "${otherSchema}" CASCADE`);
      await pool.end();
    }
  });

  beforeEach(async () =>
    run(async () => {
      const client = prisma.getClient();
      await client.schedule.updateMany({ data: { teacherId: null } });
      await client.teacher.update({
        where: { id: teacherId },
        data: { scheduledHours: 0 },
      });
      await service.saveAvailability(teacherId, { intervals: [] });
    }),
  );

  it('persiste, normaliza y aísla por proceso; permite vaciar', async () =>
    run(async () => {
      await service.saveAvailability(teacherId, {
        intervals: [
          { weekday: Weekday.Lunes, start: '07:00', end: '07:40' },
          { weekday: Weekday.Lunes, start: '07:20', end: '08:00' },
        ],
      });
      expect(await service.getAvailability(teacherId)).toEqual([
        { weekday: 'Lunes', start: '07:00', end: '08:00' },
      ]);
      expect(
        await prisma
          .getClientForSchema(otherSchema)
          .teacherAvailability.count(),
      ).toBe(0);
      await expect(
        service.saveAvailability(teacherId, {
          intervals: [{ weekday: Weekday.Lunes, start: '08:00', end: '07:00' }],
        }),
      ).rejects.toThrow();
      expect(await service.getAvailability(teacherId)).toHaveLength(1);
      await service.saveAvailability(teacherId, { intervals: [] });
      expect(await service.getAvailability(teacherId)).toEqual([]);
    }));

  it('exige cobertura completa aunque otro turno coincida parcialmente', async () =>
    run(async () => {
      await service.saveAvailability(teacherId, {
        intervals: [{ weekday: Weekday.Lunes, start: '07:00', end: '07:40' }],
      });
      await expect(
        service.assignTeacherToSchedules([classes[1]], teacherId),
      ).rejects.toThrow('fuera de la disponibilidad');
      const found = await service.findAvailableClassrooms(
        1,
        sessionIds.map((id) => ({
          id_hour_session: id,
          weekday: Weekday.Lunes,
        })),
        1,
        50,
        undefined,
        undefined,
        teacherId,
      );
      expect(found.map((cls) => cls.id)).toEqual([classes[0]]);
      expect(
        await prisma
          .getClient()
          .teacher.findUniqueOrThrow({ where: { id: teacherId } }),
      ).toMatchObject({ scheduledHours: 0 });
    }));

  it('rechaza cruces entre turnos y dentro del mismo lote sin asignar parcialmente', async () =>
    run(async () => {
      await service.saveAvailability(teacherId, {
        intervals: [{ weekday: Weekday.Lunes, start: '07:00', end: '08:40' }],
      });
      await expect(
        service.assignTeacherToSchedules([classes[0], classes[1]], teacherId),
      ).rejects.toThrow('se cruza');
      expect(
        await prisma.getClient().schedule.count({ where: { teacherId } }),
      ).toBe(0);
      await service.assignTeacherToSchedules([classes[0]], teacherId);
      const assigned = await prisma
        .getClient()
        .schedule.findFirstOrThrow({ where: { teacherId } });
      await expect(
        service.update(assigned.id, { weekday: Weekday.Martes }),
      ).rejects.toThrow('Desasigne');
      await expect(
        service.create({
          classId: classes[1],
          courseId: 1,
          hourSessionId: sessionIds[1],
          weekday: Weekday.Lunes,
          teacherId,
        }),
      ).rejects.toThrow('asignación de salones');
      await expect(
        service.assignTeacherToSchedules([classes[1]], teacherId),
      ).rejects.toThrow('se cruza');
      const teachers = new TeacherService(prisma, context);
      expect(
        (
          await teachers.getFilteredTeachers(
            {
              courseId: 1,
              hourSessions: [
                { hourSessionId: sessionIds[1], weekday: Weekday.Lunes },
              ],
            },
            1,
            50,
          )
        ).data,
      ).toHaveLength(0);
      expect(
        (
          await teachers.getFilteredTeachers(
            {
              courseId: 1,
              hourSessions: [
                { hourSessionId: sessionIds[2], weekday: Weekday.Lunes },
              ],
            },
            1,
            50,
          )
        ).data.map((teacher) => teacher.id),
      ).toEqual([teacherId]);
      await service.assignTeacherToSchedules([classes[2]], teacherId);
      expect(
        await prisma
          .getClient()
          .teacher.findUniqueOrThrow({ where: { id: teacherId } }),
      ).toMatchObject({ scheduledHours: 2 });
    }));

  it('dos asignaciones concurrentes que se cruzan no pueden confirmar ambas', async () =>
    run(async () => {
      await service.saveAvailability(teacherId, {
        intervals: [{ weekday: Weekday.Lunes, start: '07:00', end: '08:40' }],
      });
      const results = await Promise.allSettled([
        service.assignTeacherToSchedules([classes[0]], teacherId),
        service.assignTeacherToSchedules([classes[1]], teacherId),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        await prisma.getClient().schedule.count({ where: { teacherId } }),
      ).toBe(1);
      expect(
        await prisma
          .getClient()
          .teacher.findUniqueOrThrow({ where: { id: teacherId } }),
      ).toMatchObject({ scheduledHours: 1 });
    }));
});
