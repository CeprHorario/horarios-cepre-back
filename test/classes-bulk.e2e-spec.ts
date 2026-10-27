import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Pool } from 'pg';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { applyStructure } from '../src/database/prisma/structure';
import { initialDataSchema } from '../src/database/prisma/data/seed';
import { RequestContext } from '../src/database/schema-manager/request-context';
import { ClassService } from '../src/modules/classes/class.service';
import { CreateClassesDto } from '../src/modules/classes/dto/create-classes.dto';
import { ScheduleService } from '../src/modules/schedules/schedules.service';

const suite = process.env.AVAILABILITY_TEST_DATABASE_URL
  ? describe
  : describe.skip;
suite('Creación múltiple de salones y monitores', () => {
  const schema = `classes_test_${process.pid}_${Date.now()}`;
  const context = new RequestContext();
  let pool: Pool;
  let prisma: PrismaService;
  let service: ClassService;
  const run = <T>(work: () => T) => context.run({ schema }, work);
  const snapshot = async () => {
    const client = prisma.getClient();
    return [
      await client.user.count(),
      await client.monitor.count(),
      await client.class.count(),
      await client.schedule.count(),
    ];
  };

  beforeAll(async () => {
    const url = process.env.AVAILABILITY_TEST_DATABASE_URL!;
    pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await applyStructure(db, schema, true);
      await initialDataSchema(db, {
        emailDomain: '@cepr.unsa.pe',
        createSchedules: false,
        shifts: [1, 5].map((id) => ({
          name: `Turno 0${id}`,
          startTime: '07:00',
          endTime: '12:10',
          classesToAreas: [{ area: 'Biomédicas', quantityClasses: 1 }],
        })),
      });
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
    service = new ClassService(prisma, new ScheduleService(prisma));
  }, 60000);

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });

  it('crea todo el lote con monitores y 42 bloques por salón sin llamar al servicio individual', async () =>
    run(async () => {
      const client = prisma.getClient();
      const individual = jest.spyOn(client.class, 'create');
      const before = await snapshot();
      try {
        const result = await service.createMany({
          area_id: 1,
          shift_id: 1,
          quantity: 3,
        });
        expect(result).toMatchObject({
          created: 3,
          monitorsCreated: 3,
          scheduleBlocks: 126,
        });
        expect(result.classes.map((room) => room.name)).toEqual([
          'B-102 Biomédicas',
          'B-103 Biomédicas',
          'B-104 Biomédicas',
        ]);
        expect(individual).not.toHaveBeenCalled();
        expect(await snapshot()).toEqual([
          before[0] + 3,
          before[1] + 3,
          before[2] + 3,
          before[3] + 126,
        ]);
        expect(
          await client.schedule.count({ where: { teacherId: { not: null } } }),
        ).toBe(0);
      } finally {
        individual.mockRestore();
      }
    }));

  it('continúa después del máximo al borrar un salón intermedio', async () =>
    run(async () => {
      const client = prisma.getClient();
      const middle = await client.class.findFirstOrThrow({
        where: { name: 'B-103 Biomédicas' },
      });
      await client.schedule.deleteMany({ where: { classId: middle.id } });
      await client.class.delete({ where: { id: middle.id } });
      const result = await service.createMany({
        area_id: 1,
        shift_id: 1,
        quantity: 2,
      });
      expect(result.classes.map((room) => room.name)).toEqual([
        'B-105 Biomédicas',
        'B-106 Biomédicas',
      ]);
    }));

  it('admite 100 salones y cruza la centena sin índices negativos en la plantilla', async () =>
    run(async () => {
      const result = await service.createMany({
        area_id: 1,
        shift_id: 1,
        quantity: 100,
      });
      expect(result).toMatchObject({ created: 100, scheduleBlocks: 4200 });
      expect(
        result.classes.some((room) => room.name === 'B-200 Biomédicas'),
      ).toBe(true);
      expect(new Set(result.classes.map((room) => room.name)).size).toBe(100);
    }));

  it('la creación individual y múltiple concurrentes no repiten nombres ni cuentas', async () =>
    run(async () => {
      const before = await snapshot();
      const [batch, single] = await Promise.all([
        service.createMany({ area_id: 1, shift_id: 1, quantity: 2 }),
        service.create({ area_id: 1, shift_id: 1 }),
      ]);
      expect(
        new Set([...batch.classes.map((room) => room.name), single.name]).size,
      ).toBe(3);
      const after = await snapshot();
      expect(after[0] - before[0]).toBe(3);
      expect(after[2] - before[2]).toBe(3);
    }));

  it('admite turnos dinámicos como el quinto y evita números ocupados por otro turno', async () =>
    run(async () => {
      expect(
        await validate(
          plainToInstance(CreateClassesDto, {
            area_id: 1,
            shift_id: 5,
            quantity: 2,
          }),
        ),
      ).toHaveLength(0);
      expect(
        (await service.createMany({ area_id: 1, shift_id: 5, quantity: 2 }))
          .created,
      ).toBe(2);
      const client = prisma.getClient();
      const rooms = await client.class.findMany({ where: { shiftId: 1 } });
      const next =
        Math.max(
          ...rooms.map((room) => Number(room.name.match(/-(\d+)/)![1])),
        ) + 1;
      const other = await client.class.findFirstOrThrow({
        where: { shiftId: 5 },
      });
      await client.class.update({
        where: { id: other.id },
        data: { name: `B-${next} Biomédicas` },
      });
      expect(
        (await service.createMany({ area_id: 1, shift_id: 1, quantity: 1 }))
          .classes[0].name,
      ).toBe(`B-${next + 1} Biomédicas`);
    }));

  it('un turno incompleto no deja salones ni cuentas a medias', async () =>
    run(async () => {
      const client = prisma.getClient();
      const shift = await client.shift.create({ data: { name: 'Incompleto' } });
      await client.hourSession.create({
        data: {
          shiftId: shift.id,
          period: 1,
          startTime: new Date('1970-01-01T07:00:00Z'),
          endTime: new Date('1970-01-01T07:40:00Z'),
        },
      });
      const before = await snapshot();
      await expect(
        service.createMany({ area_id: 1, shift_id: shift.id, quantity: 3 }),
      ).rejects.toThrow('no se creó ningún salón');
      expect(await snapshot()).toEqual(before);
    }));

  it('conserva el monitor personalizado del endpoint individual y almacena texto SQL como datos', async () =>
    run(async () => {
      const client = prisma.getClient();
      const name = "Robert'); DROP TABLE users;--";
      const body = {
        area_id: 1,
        shift_id: 1,
        monitor: {
          email: 'custom.monitor@example.com',
          firstName: name,
          lastName: "O'Connor",
          dni: '01230000',
        },
      };
      await service.create(body);
      const user = await client.user.findUniqueOrThrow({
        where: { email: body.monitor.email },
        include: { userProfile: true },
      });
      expect(user.userProfile?.firstName).toBe(name);
      const before = await snapshot();
      await expect(service.create(body)).rejects.toThrow(
        'no se creó ningún salón',
      );
      expect(await snapshot()).toEqual(before);
    }));

  it('rechaza numeración fuera de rango sin bloquear el proceso ni crear registros', async () =>
    run(async () => {
      const client = prisma.getClient();
      const room = await client.class.findFirstOrThrow({
        where: { shiftId: 1 },
      });
      try {
        await client.class.update({
          where: { id: room.id },
          data: { name: 'B-9007199254740991 Biomédicas' },
        });
        const before = await snapshot();
        await expect(
          service.createMany({ area_id: 1, shift_id: 1, quantity: 2 }),
        ).rejects.toThrow('fuera de rango');
        expect(await snapshot()).toEqual(before);
      } finally {
        await client.class.update({
          where: { id: room.id },
          data: { name: room.name },
        });
      }
    }));

  it('rechaza cantidades inválidas e identificadores de esquema manipulados', async () =>
    run(async () => {
      for (const quantity of [0, -1, 1.5, 501]) {
        expect(
          (
            await validate(
              plainToInstance(CreateClassesDto, {
                area_id: 1,
                shift_id: 1,
                quantity,
              }),
            )
          ).length,
        ).toBeGreaterThan(0);
        await expect(
          service.createMany({ area_id: 1, shift_id: 1, quantity }),
        ).rejects.toThrow();
      }
      const before = await snapshot();
      await expect(
        context.run({ schema: 'bad"; DROP TABLE users;--' }, () =>
          service.createMany({ area_id: 1, shift_id: 1, quantity: 2 }),
        ),
      ).rejects.toThrow('Invalid process schema');
      expect(await snapshot()).toEqual(before);
    }));
});
