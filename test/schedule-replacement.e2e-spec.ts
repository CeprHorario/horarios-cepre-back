import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ConflictException, HttpException } from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { applyStructure } from '../src/database/prisma/structure';
import { RequestContext } from '../src/database/schema-manager/request-context';
import { ScheduleService } from '../src/modules/schedules/schedules.service';
import { ReplaceTeacherDto } from '../src/modules/schedules/dto/replace-teacher.dto';
import { validate } from 'class-validator';

const suite = process.env.AVAILABILITY_TEST_DATABASE_URL
  ? describe
  : describe.skip;

suite('BE-01: sustitución semanal atómica en PostgreSQL aislado', () => {
  const schema = `replacement_test_${process.pid}_${Date.now()}`;
  const otherSchema = `${schema}_other`;
  const context = new RequestContext();
  const run = <T>(work: () => T) => context.run({ schema }, work);
  let pool: Pool;
  let prisma: PrismaService;
  let service: ScheduleService;
  let classId: string;
  let otherClassId: string;
  let courseId: number;
  let otherCourseId: number;
  let original: string;
  let candidate: string;
  let alternate: string;
  let targetIds: number[];

  const body = (teacherId = candidate): ReplaceTeacherDto => ({
    classId,
    courseId,
    expectedTeacherId: original,
    teacherId,
  });
  const state = async () => {
    const db = prisma.getClient();
    return {
      schedules: await db.schedule.findMany({ orderBy: { id: 'asc' } }),
      teachers: await db.teacher.findMany({ orderBy: { id: 'asc' } }),
      availability: await db.teacherAvailability.findMany({
        orderBy: { id: 'asc' },
      }),
    };
  };
  const coherent = async () => {
    const db = prisma.getClient();
    for (const teacher of await db.teacher.findMany())
      expect(teacher.scheduledHours).toBe(
        await db.schedule.count({ where: { teacherId: teacher.id } }),
      );
  };

  beforeAll(async () => {
    const url = process.env.AVAILABILITY_TEST_DATABASE_URL!;
    if (
      new URL(url).hostname !== 'db' ||
      !/^\/cepr_records_test_[a-f0-9]{32}$/.test(new URL(url).pathname)
    )
      throw new Error('Solo runner de base aleatoria local');
    pool = new Pool({ connectionString: url });
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await applyStructure(connection, schema, true);
      await applyStructure(connection, otherSchema, true);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: url, DB_POOL_MAX: 4 }),
      context,
    );
    service = new ScheduleService(prisma);
    await run(async () => {
      const db = prisma.getClient();
      courseId = (await db.course.create({ data: { name: 'Curso sintético' } }))
        .id;
      otherCourseId = (await db.course.create({ data: { name: 'Otro curso' } }))
        .id;
      const area = await db.area.create({ data: { name: 'Área sintética' } });
      const sede = await db.sede.create({ data: { name: 'Sede sintética' } });
      const shift = await db.shift.create({ data: { name: 'Mañana' } });
      const otherShift = await db.shift.create({ data: { name: 'Solapado' } });
      classId = (
        await db.class.create({
          data: {
            name: 'Aula origen',
            areaId: area.id,
            idSede: sede.id,
            shiftId: shift.id,
          },
        })
      ).id;
      otherClassId = (
        await db.class.create({
          data: {
            name: 'Otra aula',
            areaId: area.id,
            idSede: sede.id,
            shiftId: otherShift.id,
          },
        })
      ).id;
      const ids: string[] = [];
      for (const name of ['original', 'candidate', 'alternate']) {
        const user = await db.user.create({
          data: { email: `${name}@test.invalid`, role: 'profesor' },
        });
        ids.push(
          (
            await db.teacher.create({
              data: {
                userId: user.id,
                courseId,
                maxHours: 20,
                jobStatus: 'PartTime',
              },
            })
          ).id,
        );
      }
      [original, candidate, alternate] = ids;
      targetIds = [];
      for (const [index, times] of [
        ['07:00', '07:40'],
        ['07:40', '08:20'],
        ['07:20', '08:00'],
      ].entries()) {
        const session = await db.hourSession.create({
          data: {
            shiftId: index === 2 ? otherShift.id : shift.id,
            period: index + 1,
            startTime: new Date(`1970-01-01T${times[0]}:00Z`),
            endTime: new Date(`1970-01-01T${times[1]}:00Z`),
          },
        });
        const schedule = await db.schedule.create({
          data: {
            classId: index === 2 ? otherClassId : classId,
            courseId,
            hourSessionId: session.id,
            weekday: 'Lunes',
          },
        });
        if (index < 2) targetIds.push(schedule.id);
      }
      const session = await db.hourSession.findFirstOrThrow();
      await db.schedule.create({
        data: {
          classId,
          courseId: otherCourseId,
          hourSessionId: session.id,
          weekday: 'Martes',
        },
      });
    });
  }, 60000);

  beforeEach(async () =>
    run(async () => {
      const db = prisma.getClient();
      await db.schedule.updateMany({ data: { teacherId: null } });
      await db.schedule.updateMany({
        where: { id: { in: targetIds } },
        data: { teacherId: original },
      });
      await db.user.updateMany({ data: { isActive: true } });
      await db.teacher.updateMany({
        data: { courseId, scheduledHours: 0, maxHours: 20 },
      });
      await db.teacher.update({
        where: { id: original },
        data: { scheduledHours: 2 },
      });
      for (const id of [original, candidate, alternate])
        await service.saveAvailability(id, {
          intervals: [{ weekday: 'Lunes', start: '07:00', end: '10:00' }],
        });
    }),
  );

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.query(`DROP SCHEMA IF EXISTS "${otherSchema}" CASCADE`);
      await pool.end();
    }
  });

  it('BA-01/07: mueve todos y solo los bloques objetivo, cargas exactas y reenvío 409', async () =>
    run(async () => {
      const before = await state();
      expect(await service.replaceTeacher(body())).toEqual({
        classId,
        courseId,
        teacherId: candidate,
        previousTeacherId: original,
        updatedSchedules: 2,
      });
      const after = await state();
      expect(after.availability).toEqual(before.availability);
      expect(
        after.schedules.filter((row) => !targetIds.includes(row.id)),
      ).toEqual(before.schedules.filter((row) => !targetIds.includes(row.id)));
      expect(
        after.schedules
          .filter((row) => targetIds.includes(row.id))
          .every((row) => row.teacherId === candidate),
      ).toBe(true);
      await coherent();
      await expect(service.replaceTeacher(body())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(await state()).toEqual(after);
    }));

  it.each([
    'parcial',
    'cruce',
    'carga',
    'inactivo',
    'curso',
    'iguales',
    'salón',
    'mezcla',
    'inconsistente',
  ])('BA-02/03: rechaza %s sin cambio parcial', async (kind) =>
    run(async () => {
      const db = prisma.getClient();
      const input = body();
      if (kind === 'parcial')
        await service.saveAvailability(candidate, {
          intervals: [{ weekday: 'Lunes', start: '07:00', end: '08:00' }],
        });
      if (kind === 'cruce') {
        await db.schedule.updateMany({
          where: { classId: otherClassId },
          data: { teacherId: candidate },
        });
        await db.teacher.update({
          where: { id: candidate },
          data: { scheduledHours: 1 },
        });
      }
      if (kind === 'carga')
        await db.teacher.update({
          where: { id: candidate },
          data: { maxHours: 1 },
        });
      if (kind === 'inactivo') {
        const teacher = await db.teacher.findUniqueOrThrow({
          where: { id: candidate },
        });
        await db.user.update({
          where: { id: teacher.userId },
          data: { isActive: false },
        });
      }
      if (kind === 'curso')
        await db.teacher.update({
          where: { id: candidate },
          data: { courseId: otherCourseId },
        });
      if (kind === 'iguales') input.teacherId = original;
      if (kind === 'salón') input.classId = randomUUID();
      if (kind === 'mezcla')
        await db.schedule.update({
          where: { id: targetIds[1] },
          data: { teacherId: null },
        });
      if (kind === 'inconsistente')
        await db.teacher.update({
          where: { id: original },
          data: { scheduledHours: 1 },
        });
      const before = await state();
      await expect(service.replaceTeacher(input)).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(await state()).toEqual(before);
    }),
  );

  it('conserva retirada del titular inactivo', async () =>
    run(async () => {
      const db = prisma.getClient();
      const teacher = await db.teacher.findUniqueOrThrow({
        where: { id: original },
      });
      await db.user.update({
        where: { id: teacher.userId },
        data: { isActive: false },
      });
      await service.replaceTeacher(body());
      await coherent();
    }));

  it('BA-04: dos sustituciones sobre el mismo origen: un éxito y un conflicto', async () =>
    run(async () => {
      const results = await Promise.allSettled([
        service.replaceTeacher(body()),
        service.replaceTeacher(body(alternate)),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(
        rejected?.status === 'rejected' &&
          rejected.reason instanceof ConflictException,
      ).toBe(true);
      await coherent();
    }));

  it.each(['asignar', 'retirar'])(
    'BA-05: carrera con %s conserva cargas y exclusión',
    async (kind) =>
      run(async () => {
        const concurrent =
          kind === 'asignar'
            ? service.assignTeacherToSchedules([otherClassId], candidate)
            : service.unassignTeacherFromSchedules([classId], original);
        const results = await Promise.allSettled([
          service.replaceTeacher(body()),
          concurrent,
        ]);
        expect(
          results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        await coherent();
      }),
  );

  it('BA-06: fallo SQL entre bloques y cargas revierte toda la transacción', async () =>
    run(async () => {
      const before = await state();
      await pool.query(
        `CREATE FUNCTION "${schema}".fail_load() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo sintético de carga'; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER fail_load BEFORE UPDATE ON "${schema}".teachers FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_load()`,
      );
      try {
        await expect(service.replaceTeacher(body())).rejects.toThrow(
          'fallo sintético de carga',
        );
        expect(await state()).toEqual(before);
      } finally {
        await pool.query(`DROP TRIGGER fail_load ON "${schema}".teachers`);
        await pool.query(`DROP FUNCTION "${schema}".fail_load()`);
      }
    }));

  it('BA-08: mismo ID no autoriza acceso a recursos de otro proceso', async () => {
    await context.run({ schema: otherSchema }, async () => {
      await expect(service.replaceTeacher(body())).rejects.toMatchObject({
        status: 404,
      });
      expect(await prisma.getClient().schedule.count()).toBe(0);
    });
  });

  it('BA-03: DTO rechaza UUID y curso inválidos', async () => {
    for (const values of [
      { classId: 'invalid' },
      { teacherId: 'invalid' },
      { expectedTeacherId: 'invalid' },
      { courseId: 0 },
      { courseId: 1.5 },
    ])
      expect(
        await validate(Object.assign(new ReplaceTeacherDto(), body(), values)),
      ).not.toHaveLength(0);
  });
});
