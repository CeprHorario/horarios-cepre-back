import {
  Controller,
  Get,
  Delete,
  Patch,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaModule } from '../src/database/prisma/prisma.module';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { DrizzleService } from '../src/database/drizzle/drizzle.service';
import { applyStructure } from '../src/database/prisma/structure';
import { AdmissionsService } from '../src/modules/admissions/admissions.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { RuntimeConfigService } from '../src/modules/runtime-config/runtime-config.service';
import { RuntimeConfig } from '../src/modules/runtime-config/interfaces/runtime-config.interface';
import {
  Authorization,
  Role,
  AUTHORIZATION_METADATA_KEY,
} from '../src/modules/auth/decorators/authorization.decorator';
import { Unauthenticated } from '../src/modules/auth/decorators/unauthenticated.decorator';
import { ConfigurationDto } from '../src/modules/admissions/dto/create-admission.dto';
import { SyncAuthorizationService } from '../src/modules/auth/sync-authorization.service';

@Controller('schedule')
class SharedPermissionController {
  @Delete(':id')
  @Authorization({
    permission: 'schedule.delete',
    description: 'Eliminar un horario por id',
  })
  remove() {
    return true;
  }
  @Patch('asignar/profesor')
  @Authorization({
    permission: 'schedule.delete',
    description: 'Eliminar un horario por id',
  })
  assign() {
    return true;
  }
  @Patch('desasignar/profesor')
  @Authorization({
    permission: 'schedule.delete',
    description: 'Desasignar profesor de horarios',
  })
  unassign(this: void) {
    return true;
  }
}

let entered: (() => void) | undefined;
let resume: Promise<void> = Promise.resolve();

@Controller('probe')
class ProbeController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @Authorization({
    roles: [Role.ADMIN, Role.MONITOR],
    permission: 'probe.read',
  })
  async read() {
    entered?.();
    await resume;
    return this.prisma.getClient().$transaction(async (tx) => {
      await setTimeout(5);
      return tx.user.findMany({
        select: { email: true },
        orderBy: { email: 'asc' },
      });
    });
  }
  @Get('public')
  @Unauthenticated()
  publicRead() {
    return this.read();
  }
}

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite('PostgreSQL 18: provisioning and routing', () => {
  let pool: Pool;
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let admissions: AdmissionsService;
  let schemas: SchemaManagerService;
  let runtime: RuntimeConfig | null;
  let adminToken: string;
  let userToken: string;

  const body = (name: string, configuration?: ConfigurationDto) => ({
    name,
    year: 2026,
    sede: 'Sede Virtual',
    started: new Date('2026-01-01'),
    finished: new Date('2026-12-31'),
    configuration,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await migrate(drizzle(pool), {
      migrationsFolder: 'src/database/drizzle/migrations',
    });
    const temporary = new DrizzleService(
      new ConfigService({
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        DB_POOL_MAX: 2,
      }),
    );
    await temporary.transaction((db) =>
      applyStructure(db, 'core_schema', true),
    );
    await temporary.onModuleDestroy();
    const module = await Test.createTestingModule({
      imports: [AppModule, PrismaModule],
      controllers: [ProbeController, SharedPermissionController],
    })
      .overrideProvider(RuntimeConfigService)
      .useValue({ getCurrent: () => Promise.resolve(runtime) })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    admissions = app.get(AdmissionsService);
    schemas = app.get(SchemaManagerService);
    await admissions.create(body('alpha'));
    await admissions.create(body('beta'));
    const admin = await prisma.getClientForSchema('core_schema').user.create({
      data: { email: 'admin@example.com', role: 'administrador' },
    });
    const user = await prisma
      .getClientForSchema('beta_2026')
      .user.create({ data: { email: 'beta@example.com', role: 'monitor' } });
    await prisma
      .getClientForSchema('alpha_2026')
      .user.create({ data: { email: 'alpha@example.com', role: 'monitor' } });
    const jwt = app.get(JwtService);
    adminToken = jwt.sign({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      schema: 'core_schema',
    });
    userToken = jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      schema: 'beta_2026',
    });
    runtime = {
      version: 1,
      maintenance: { enabled: false, message: '', endsAt: null },
      schemaRouting: { adminSchema: 'alpha_2026', userSchema: 'beta_2026' },
      updatedAt: null,
      updatedBy: { id: admin.id, email: admin.email },
      changeReason: 'test',
    };
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('generates UUIDv7 in SQL and nested Prisma writes, preserving imported UUIDv4', async () => {
    const client = prisma.getClientForSchema('core_schema');
    const parent = await client.user.create({
      data: {
        email: 'nested@example.com',
        role: 'monitor',
        userProfile: { create: { firstName: 'A', lastName: 'B' } },
        monitor: { create: {} },
      },
      include: { userProfile: true, monitor: true },
    });
    for (const id of [parent.id, parent.userProfile!.id, parent.monitor!.id])
      expect(id[14]).toBe('7');
    expect(parent.monitor?.userId).toBe(parent.id);
    const sql = await pool.query<{ id: string }>(
      "INSERT INTO core_schema.users (email, role) VALUES ('sql@example.com', 'monitor') RETURNING id",
    );
    expect(sql.rows[0].id[14]).toBe('7');
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      (
        await client.user.create({
          data: { id, email: 'v4@example.com', role: 'monitor' },
        })
      ).id,
    ).toBe(id);
    await client.course.create({ data: { id: 1, name: 'Course' } });
    const teacher = await client.teacher.create({
      data: { userId: parent.id, courseId: 1, jobStatus: 'FullTime' },
    });
    expect(teacher.jobStatus).toBe('FullTime');
    expect(
      (
        await pool.query<{ job_status: string }>(
          'SELECT job_status FROM core_schema.teachers WHERE id = $1',
          [teacher.id],
        )
      ).rows[0].job_status,
    ).toBe('FULL_TIME');
  });

  it('seeds parent IDs and sequences in one transaction; rolls back failed processes', async () => {
    const configuration: ConfigurationDto = {
      emailDomain: '@example.com',
      createSchedules: true,
      shifts: [
        {
          name: 'Turno 01',
          startTime: '08:00',
          endTime: '13:10',
          classesToAreas: [{ area: 'Extraordinario', quantityClasses: 1 }],
        },
      ],
    };
    await admissions.create(body('seeded', configuration));
    const client = prisma.getClientForSchema('seeded_2026');
    const classes = await client.class.findMany({
      include: { monitor: { include: { user: true } } },
    });
    expect(classes).toHaveLength(1);
    expect(classes[0].id[14]).toBe('7');
    expect(classes[0].monitor?.user.id[14]).toBe('7');
    expect(await client.schedule.count()).toBeGreaterThan(0);
    expect(
      (await client.course.create({ data: { name: 'Extra course' } })).id,
    ).toBe(4);
    const previous = await schemas.getCurrent();
    await expect(
      admissions.create(
        body('broken', {
          ...configuration,
          shifts: [{ ...configuration.shifts[0], endTime: '07:00' }],
        }),
      ),
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          "SELECT 1 FROM pg_namespace WHERE nspname = 'broken_2026'",
        )
      ).rowCount,
    ).toBe(0);
    expect(await schemas.getCurrent()).toEqual(previous);
    await expect(admissions.setCurrent('missing_2026')).rejects.toThrow();
    expect(await schemas.getCurrent()).toEqual(previous);
  });

  it('isolates concurrent HTTP subscriptions and Prisma transactions through one pool', async () => {
    const responses = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        request(app.getHttpServer())
          .get('/api/probe')
          .auth(i % 2 ? adminToken : userToken, { type: 'bearer' })
          .expect(200),
      ),
    );
    responses.forEach((response, i) =>
      expect(response.body).toEqual([
        { email: i % 2 ? 'alpha@example.com' : 'beta@example.com' },
      ]),
    );
    await request(app.getHttpServer())
      .get('/api/probe/public')
      .expect(200)
      .expect([{ email: 'beta@example.com' }]);
    expect(() => prisma.getClient()).toThrow('Missing request');
    const connections = await pool.query<{ count: string }>(
      "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'cepr-prisma'",
    );
    expect(Number(connections.rows[0].count)).toBeGreaterThan(0);
    expect(Number(connections.rows[0].count)).toBeLessThanOrEqual(2);
    await prisma.getClientForSchema('core_schema').$disconnect();
    expect(await prisma.getClientForSchema('alpha_2026').user.count()).toBe(1);
  });

  it('pins configuration before authentication and keeps in-flight clients usable', async () => {
    let release!: () => void;
    resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = request(app.getHttpServer())
      .get('/api/probe')
      .auth(adminToken, { type: 'bearer' })
      .then((response) => response);
    await started;
    const old = runtime!;
    runtime = {
      ...old,
      version: 2,
      schemaRouting: { adminSchema: 'beta_2026', userSchema: 'alpha_2026' },
    };
    await admissions.setCurrent('beta_2026');
    release();
    expect((await pending).body).toEqual([{ email: 'alpha@example.com' }]);
    entered = undefined;
    await request(app.getHttpServer())
      .get('/api/probe')
      .auth(adminToken, { type: 'bearer' })
      .expect(200)
      .expect([{ email: 'beta@example.com' }]);
    runtime = old;
  });

  it('rejects client selection, inactive admin identity and missing physical schemas', async () => {
    await request(app.getHttpServer())
      .get('/api/probe')
      .set('x-schema', 'alpha_2026')
      .auth(adminToken, { type: 'bearer' })
      .expect(400);
    await pool.query(
      "INSERT INTO public.admission_processes (name, year, structure_version) VALUES ('ghost_2026', 2026, 'missing')",
    );
    expect(await schemas.schemaExists('ghost_2026')).toBe(false);
    const old = runtime!;
    runtime = {
      ...old,
      schemaRouting: { ...old.schemaRouting, adminSchema: 'ghost_2026' },
    };
    await request(app.getHttpServer())
      .get('/api/probe')
      .auth(adminToken, { type: 'bearer' })
      .expect(503);
    runtime = old;
    await prisma.getClientForSchema('core_schema').user.update({
      where: { email: 'admin@example.com' },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .get('/api/probe')
      .auth(adminToken, { type: 'bearer' })
      .expect(401);
  });

  it('synchronizes shared permissions idempotently without deleting imported IDs or grants', async () => {
    await pool.query(
      "INSERT INTO public.roles (id, name) VALUES (1000, 'custom_role')",
    );
    await pool.query(
      "INSERT INTO public.permissions (id, name, path, method_http) VALUES (1000, 'teacher.pending-module', 'api/teacher/pending', 'GET')",
    );
    await pool.query(
      'INSERT INTO public.roles_permissions (role_id, permission_id) VALUES (1000, 1000)',
    );
    const sync = app.get(SyncAuthorizationService);
    const first = await sync.syncAuthorization();
    expect(
      first.data.filter((route) => route.permission === 'schedule.delete'),
    ).toHaveLength(4); // Three probe routes plus the real DELETE /schedules/:id.
    const snapshot = async () =>
      Promise.all(
        ['roles', 'permissions', 'roles_permissions'].map(
          async (table) =>
            (await pool.query(`SELECT * FROM public.${table} ORDER BY 1, 2`))
              .rows as unknown[],
        ),
      );
    const before = await snapshot();
    await Promise.all([sync.syncAuthorization(), sync.syncAuthorization()]);
    expect(await snapshot()).toEqual(before);
    await prisma.getClientForSchema('core_schema').user.update({
      where: { email: 'admin@example.com' },
      data: { isActive: true },
    });
    const response = await request(app.getHttpServer())
      .get('/api/roles/permissions')
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(Array.isArray(response.body)).toBe(true);
    const shared = await pool.query<{ id: number }>(
      "SELECT id FROM public.permissions WHERE name = 'schedule.delete'",
    );
    expect(shared.rows).toHaveLength(1);
    expect(
      (
        await pool.query(
          'SELECT * FROM public.roles_permissions WHERE role_id = 1000 AND permission_id = 1000',
        )
      ).rowCount,
    ).toBe(1);
    const handler = SharedPermissionController.prototype.unassign;
    const original: unknown = Reflect.getMetadata(
      AUTHORIZATION_METADATA_KEY,
      handler,
    );
    Reflect.defineMetadata(
      AUTHORIZATION_METADATA_KEY,
      { permission: 'schedule.delete', roles: [Role.MONITOR] },
      handler,
    );
    try {
      await expect(sync.syncAuthorization()).rejects.toThrow(
        'Conflicting roles',
      );
    } finally {
      Reflect.defineMetadata(AUTHORIZATION_METADATA_KEY, original, handler);
    }
    expect(await snapshot()).toEqual(before);
  });
});
