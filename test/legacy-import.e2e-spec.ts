import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { applyStructure } from '../src/database/prisma/structure';
import { RequestContext } from '../src/database/schema-manager/request-context';
import { TeacherService } from '../src/modules/teachers/teacher.service';
import type { CreateTeacherDto } from '../src/modules/teachers/dto/import-teacher.dto';

const suite = process.env.AVAILABILITY_TEST_DATABASE_URL
  ? describe
  : describe.skip;
suite(
  'Importación JSON heredada: compatibilidad y escritura por conjuntos',
  () => {
    const schema = `legacy_test_${process.pid}_${Date.now()}`;
    const context = new RequestContext();
    let pool: Pool;
    let prisma: PrismaService;
    let teachers: TeacherService;
    const run = <T>(work: () => T) => context.run({ schema }, work);
    const person = (index: number): CreateTeacherDto => ({
      email: `teacher${index}@example.com`,
      dni: String(10000000 + index),
      firstName: 'Ana',
      lastName: 'Pérez',
      courseId: 1,
      jobStatus: 'PartTime',
      maxHours: 99,
      phonesAdditional: ['987654321'],
    });

    beforeAll(async () => {
      const url = process.env.AVAILABILITY_TEST_DATABASE_URL!;
      pool = new Pool({ connectionString: url });
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await applyStructure(db, schema, true);
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
      teachers = new TeacherService(prisma, context);
      await run(() =>
        prisma.getClient().course.create({ data: { name: 'Física' } }),
      );
    }, 60000);

    afterAll(async () => {
      await prisma?.onModuleDestroy();
      if (pool) {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
      }
    });

    it('mantiene creados/noCreados y omite duplicados de la BD y del archivo', async () =>
      run(async () => {
        await teachers.createManyTeachers([person(1)]);
        const duplicateDni = { ...person(3), dni: person(1).dni };
        const result = await teachers.createManyTeachers([
          person(1),
          duplicateDni,
          person(2),
          person(2),
          person(4),
        ]);
        expect(result.creados).toEqual(
          [person(2), person(4)].map(({ email, dni }) => ({ email, dni })),
        );
        expect(result.noCreados.map((row) => row.motivo)).toEqual([
          'email duplicado',
          'dni duplicado',
          'email duplicado',
        ]);
        expect(await prisma.getClient().teacher.count()).toBe(3);
        expect(await teachers.createManyTeachers([])).toEqual({
          creados: [],
          noCreados: [],
        });
      }));

    it('crea 1000 docentes sin llamadas de escritura por registro y conserva las reglas históricas', async () =>
      run(async () => {
        const client = prisma.getClient();
        const singleInsert = jest.spyOn(client.user, 'create');
        try {
          const rows = Array.from({ length: 1000 }, (_, index) =>
            person(1000 + index),
          );
          rows[0] = { ...rows[0], isCoordinator: true, jobStatus: 'FullTime' };
          expect(
            (await teachers.createManyTeachers(rows)).creados,
          ).toHaveLength(1000);
          expect(singleInsert).not.toHaveBeenCalled();
          expect(
            await client.teacher.findFirstOrThrow({
              where: { user: { email: rows[0].email } },
            }),
          ).toMatchObject({ maxHours: 12, isCoordinator: true });
          expect(
            await client.teacher.findFirstOrThrow({
              where: { user: { email: rows[1].email } },
            }),
          ).toMatchObject({ maxHours: 20 });
        } finally {
          singleInsert.mockRestore();
        }
      }));

    it('un error después de las primeras 30 filas revierte todos los docentes nuevos', async () =>
      run(async () => {
        const rows = Array.from({ length: 35 }, (_, index) =>
          person(5000 + index),
        );
        rows[34].courseId = 9999;
        await expect(teachers.createManyTeachers(rows)).rejects.toThrow(
          'no se creó ningún docente',
        );
        expect(
          await prisma.getClient().user.count({
            where: { email: { in: rows.map((row) => row.email) } },
          }),
        ).toBe(0);
      }));
    it('conserva DNI vacío como valor único y permite omitirlo en varias cuentas', async () =>
      run(async () => {
        const blank = { ...person(7000), dni: '' };
        await teachers.createManyTeachers([blank]);
        expect(
          (await teachers.createManyTeachers([{ ...person(7001), dni: '' }]))
            .noCreados[0].motivo,
        ).toBe('dni duplicado');
        const missing = [person(7002), person(7003)];
        missing.forEach((row) => {
          delete (row as Partial<CreateTeacherDto>).dni;
        });
        expect((await teachers.createManyTeachers(missing)).creados).toEqual(
          missing.map((row) => ({ email: row.email, dni: null })),
        );
      }));
  },
);
