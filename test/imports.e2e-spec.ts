import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import ExcelJS from 'exceljs';
import { DrizzleService } from '../src/database/drizzle/drizzle.service';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { applyStructure } from '../src/database/prisma/structure';
import { RequestContext } from '../src/database/schema-manager/request-context';
import { ImportsService } from '../src/modules/imports/imports.service';
import { AdmissionsService } from '../src/modules/admissions/admissions.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { headers, type ImportKind } from '../src/modules/imports/workbook';
import { IMPORT_KINDS, readImport } from '../src/modules/imports/workbook';
import { importColumns } from '../src/modules/imports/columns';

const suite = process.env.AVAILABILITY_TEST_DATABASE_URL
  ? describe
  : describe.skip;
suite(
  'Lotes reales: Excel, cuentas de salón, disponibilidad y desasignación',
  () => {
    const schema = `imports_test_${process.pid}_${Date.now()}`;
    const context = new RequestContext();
    let pool: Pool;
    let drizzle: DrizzleService;
    let prisma: PrismaService;
    let imports: ImportsService;
    let teacherId: string;
    let classIds: string[];
    let monitorUsers: string[];
    const run = <T>(work: () => T) => context.run({ schema }, work);
    const file = (rows: Record<string, string>[]) =>
      Buffer.from(JSON.stringify(rows));
    const person = {
      correo: 'supervisor@example.com',
      dni: '01234567',
      nombres: 'Ana',
      apellidos: 'Perez',
      correo_personal: '',
      celular: '987654321',
    };
    const time = {
      correo: 'teacher@example.com',
      dia: 'Lunes',
      hora_inicio: '07:00',
      hora_fin: '08:40',
    };
    const apply = (kind: ImportKind, rows: Record<string, string>[]) =>
      imports.apply(kind, file(rows), 'test.json', schema);

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
      const config = new ConfigService({ DATABASE_URL: url, DB_POOL_MAX: 2 });
      drizzle = new DrizzleService(config);
      prisma = new PrismaService(config, context);
      imports = new ImportsService(drizzle, context);
      await run(async () => {
        const client = prisma.getClient();
        const course = await client.course.create({ data: { name: 'Física' } });
        const area = await client.area.create({ data: { name: 'Biomédicas' } });
        const sede = await client.sede.create({ data: { name: 'Virtual' } });
        const shift = await client.shift.create({ data: { name: 'Turno 01' } });
        const user = await client.user.create({
          data: { email: 'teacher@example.com', role: 'profesor' },
        });
        teacherId = (
          await client.teacher.create({
            data: {
              userId: user.id,
              courseId: course.id,
              maxHours: 20,
              jobStatus: 'PartTime',
            },
          })
        ).id;
        const session = await client.hourSession.create({
          data: {
            shiftId: shift.id,
            period: 1,
            startTime: new Date('1970-01-01T07:00:00Z'),
            endTime: new Date('1970-01-01T07:40:00Z'),
          },
        });
        classIds = [];
        monitorUsers = [];
        for (const index of [1, 2]) {
          const monitorUser = await client.user.create({
            data: { email: `monitor${index}@example.com`, role: 'monitor' },
          });
          const monitor = await client.monitor.create({
            data: { userId: monitorUser.id },
          });
          const cls = await client.class.create({
            data: {
              name: `B-10${index} Biomédicas`,
              areaId: area.id,
              idSede: sede.id,
              shiftId: shift.id,
              monitorId: monitor.id,
            },
          });
          await client.schedule.create({
            data: {
              classId: cls.id,
              hourSessionId: session.id,
              courseId: course.id,
              weekday: index === 1 ? 'Lunes' : 'Martes',
            },
          });
          classIds.push(cls.id);
          monitorUsers.push(monitorUser.id);
        }
      });
    }, 60000);

    afterAll(async () => {
      await prisma?.onModuleDestroy();
      await drizzle?.onModuleDestroy();
      if (pool) {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
      }
    });

    it('agrega 1000 rangos en lote, une duplicados y recorta sin borrar otros días', async () =>
      run(async () => {
        expect(
          await apply(
            'disponibilidad',
            Array.from({ length: 1000 }, () => time),
          ),
        ).toMatchObject({ teachers: 1 });
        const client = prisma.getClient();
        expect(await client.teacherAvailability.count()).toBe(1);
        await apply('disponibilidad', [{ ...time, dia: 'Martes' }]);
        await apply('retirar-disponibilidad', [
          { ...time, hora_inicio: '07:20', hora_fin: '08:00' },
        ]);
        const monday = await client.teacherAvailability.findMany({
          where: { weekday: 'Lunes' },
          orderBy: { startMinute: 'asc' },
        });
        expect(monday.map((r) => [r.startMinute, r.endMinute])).toEqual([
          [420, 440],
          [480, 520],
        ]);
        expect(
          await client.teacherAvailability.count({
            where: { weekday: 'Martes' },
          }),
        ).toBe(1);
      }));

    it('rechaza todo el archivo ante un correo inexistente y ante un cambio de proceso', async () =>
      run(async () => {
        const before = await prisma
          .getClient()
          .teacherAvailability.findMany({ orderBy: { id: 'asc' } });
        const rows = [time, { ...time, correo: 'missing@example.com' }];
        const preview = await imports.preview(
          'disponibilidad',
          file(rows),
          'test.json',
        );
        expect(preview.valid).toBe(1);
        await expect(apply('disponibilidad', rows)).rejects.toThrow(
          'El lote contiene errores',
        );
        expect(
          await prisma
            .getClient()
            .teacherAvailability.findMany({ orderBy: { id: 'asc' } }),
        ).toEqual(before);
        await expect(
          imports.apply(
            'disponibilidad',
            file([time]),
            'test.json',
            'other_process',
          ),
        ).rejects.toThrow('El proceso cambió');
      }));

    it('lee la plantilla Excel y actualiza la cuenta de monitor existente sin duplicarla', async () =>
      run(async () => {
        const template = await imports.template('monitores');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(
          template as unknown as Parameters<typeof workbook.xlsx.load>[0],
        );
        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
          'Datos',
          'Guia',
          'Horarios',
          'Salones',
          'Cursos',
          'Cabeceras',
        ]);
        const sheet = workbook.getWorksheet('Datos')!;
        const data = {
          ...person,
          correo: 'nuevo.monitor@example.com',
          salon: 'B-101',
          turno: 'Turno 01',
          dni: '00001234',
        };
        sheet.getRow(2).values = headers.monitores.map(
          (key) => data[key as keyof typeof data],
        );
        const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
        expect(
          (await imports.preview('monitores', buffer, 'test.xlsx')).valid,
        ).toBe(1);
        const count = await prisma.getClient().monitor.count();
        await imports.apply('monitores', buffer, 'test.xlsx', schema);
        expect(await prisma.getClient().monitor.count()).toBe(count);
        expect(
          await prisma
            .getClient()
            .user.findUniqueOrThrow({ where: { id: monitorUsers[0] } }),
        ).toMatchObject({ email: 'monitor1@example.com' });
        expect(
          await prisma.getClient().userProfile.findUniqueOrThrow({
            where: { userId: monitorUsers[0] },
          }),
        ).toMatchObject({ dni: '00001234' });
        const invalid = await imports.preview('monitores', file([{ ...data, correo: 'cambio@example.com' }]), 'test.json');
        expect(invalid.valid).toBe(0);
        expect(invalid.rows[0].errors.join(' ')).toContain('no se modifica');
      }));

    it('crea un supervisor para dos salones y permite repetir el lote sin duplicados', async () =>
      run(async () => {
        const rows = ['B-101', 'B-102'].map((salon) => ({
          ...person,
          salon,
          turno: 'Turno 01',
        }));
        const before = await prisma.getClient().monitor.findMany({
          select: { id: true, user: { select: { email: true } } },
          orderBy: { id: 'asc' },
        });
        await apply('supervisores', rows);
        await apply('supervisores', rows);
        const client = prisma.getClient();
        expect(await client.supervisor.count()).toBe(1);
        expect(
          await client.supervisor.findFirstOrThrow({
            include: { users: true },
          }),
        ).toMatchObject({ users: { email: person.correo } });
        expect(
          await client.monitor.findMany({
            select: { id: true, user: { select: { email: true } } },
            orderBy: { id: 'asc' },
          }),
        ).toEqual(before);
        const monitors = await client.monitor.findMany();
        expect(new Set(monitors.map((m) => m.supervisorId)).size).toBe(1);
        expect(monitors.every((m) => m.supervisorId !== null)).toBe(true);
      }));

    it('registra docentes con consultas por conjunto y respeta las horas máximas del archivo', async () =>
      run(async () => {
        const teacher = {
          ...person,
          correo: 'new.teacher@example.com',
          dni: '12340000',
          curso: 'Física',
          dedicacion: 'Medio tiempo',
          horas_maximas: '13',
        };
        await apply('docentes', [teacher]);
        expect(
          await prisma.getClient().teacher.findFirstOrThrow({
            where: { user: { email: teacher.correo } },
          }),
        ).toMatchObject({ maxHours: 13 });
        await expect(apply('docentes', [teacher])).rejects.toThrow(
          'El lote contiene errores',
        );
      }));

    it('desasigna múltiples salones en una operación y conserva disponibilidad y contadores', async () =>
      run(async () => {
        const client = prisma.getClient();
        await client.schedule.updateMany({ data: { teacherId } });
        await client.teacher.update({
          where: { id: teacherId },
          data: { scheduledHours: 2 },
        });
        const availabilityCount = await client.teacherAvailability.count();
        const rows = ['B-101', 'B-102'].map((salon) => ({
          correo: time.correo,
          salon,
          turno: 'Turno 01',
        }));

        expect(await apply('desasignaciones', rows)).toMatchObject({
          blocks: 2,
        });
        expect(await client.schedule.count({ where: { teacherId } })).toBe(0);
        expect(
          await client.teacher.findUniqueOrThrow({ where: { id: teacherId } }),
        ).toMatchObject({ scheduledHours: 0 });
        expect(await client.teacherAvailability.count()).toBe(
          availabilityCount,
        );
        expect(classIds).toHaveLength(2);
      }));

    it('las seis plantillas tienen cabeceras, formatos, comentarios y guía coincidentes con la importación', async () =>
      run(async () => {
        for (const kind of IMPORT_KINDS) {
          const buffer = await imports.template(kind);
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(
            buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
          );
          const sheet = workbook.getWorksheet('Datos')!;
          const reference = workbook.getWorksheet('Cabeceras')!;
          const columns = importColumns(kind);
          expect(columns.map((column) => column.key)).toEqual(headers[kind]);
          expect(reference.rowCount).toBe(columns.length + 1);
          expect(sheet.views[0]).toMatchObject({
            state: 'frozen',
            ySplit: 1,
          });
          expect(sheet.autoFilter).toBeTruthy();
          columns.forEach((column, index) => {
            expect(sheet.getRow(1).getCell(index + 1).text).toBe(column.label);
            expect(column.format.length).toBeGreaterThan(0);
            expect(column.description.length).toBeGreaterThan(0);
            expect(sheet.getRow(1).getCell(index + 1).note).toBeTruthy();
            expect(sheet.getRow(1).getCell(index + 1).fill).toMatchObject({
              type: 'pattern',
              fgColor: { argb: column.required ? 'FF661124' : 'FF1C2140' },
            });
          });
          const parsed = await readImport(buffer, 'template.xlsx', kind);
          expect(parsed).toHaveLength(1);
          if (headers[kind].includes('dni')) {
            expect(
              sheet.getColumn(headers[kind].indexOf('dni') + 1).numFmt,
            ).toBe('@');
            expect(parsed[0].values.dni).toBe('01234567');
          }
          if (kind === 'docentes')
            expect(parsed[0].values.horas_maximas).toBe('20');
          if (kind === 'supervisores')
            expect(
              columns.find((column) => column.key === 'correo')?.description,
            ).toContain('supervisor');
        }
      }));

    it('crea un proceso con clase/descanso configurables y lote de monitores; revierte la prueba completa', async () => {
      const db = await pool.connect();
      const name = `timingtest${process.pid}`;
      try {
        await db.query('BEGIN');
        const scoped = {
          transaction: <T>(work: (db: import('pg').PoolClient) => Promise<T>) =>
            work(db),
        } as unknown as DrizzleService;
        const admissions = new AdmissionsService(
          {} as SchemaManagerService,
          scoped,
        );
        await admissions.create({
          name,
          year: 2026,
          sede: 'Sede Virtual',
          started: new Date('2026-01-01'),
          finished: new Date('2026-12-31'),
          configuration: {
            emailDomain: '@example.com',
            createSchedules: true,
            sessionMinutes: 50,
            breakMinutes: 10,
            shifts: [
              {
                name: 'Turno 01',
                startTime: '07:00',
                endTime: '13:50',
                classesToAreas: [
                  { area: 'Biomédicas', quantityClasses: 2 },
                  { area: 'Sociales', quantityClasses: 0 },
                ],
              },
            ],
          },
        });
        const process = await db.query(
          'SELECT session_minutes,break_minutes FROM public.admission_processes WHERE name=$1',
          [`${name}_2026`],
        );
        expect(process.rows[0]).toEqual({
          session_minutes: 50,
          break_minutes: 10,
        });
        const hours = await db.query<{ duration_minutes: number }>(
          `SELECT duration_minutes FROM "${name}_2026".hour_sessions`,
        );
        expect(hours.rows).toHaveLength(7);
        expect(hours.rows.every((h) => h.duration_minutes === 50)).toBe(true);
        expect(
          (
            await db.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM "${name}_2026".monitors`,
            )
          ).rows[0].count,
        ).toBe(2);
      } finally {
        await db.query('ROLLBACK');
        db.release();
      }
    }, 30000);
  },
);
