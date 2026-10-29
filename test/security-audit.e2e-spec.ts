/** Opt-in security regression suite using disposable data and permissive historical grants. */
import { Test } from '@nestjs/testing';
import { INestApplication, ParseArrayPipe } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import request from 'supertest';
import { Pool } from 'pg';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { applyStructure } from '../src/database/prisma/structure';
import { initialDataSchema } from '../src/database/prisma/data/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { RequestContext } from '../src/database/schema-manager/request-context';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { RuntimeConfigService } from '../src/modules/runtime-config/runtime-config.service';
import { PermissionsService } from '../src/modules/permissions/permissions.service';
import { AUTHORIZATION_METADATA_KEY } from '../src/modules/auth/decorators/authorization.decorator';
import { IS_PUBLIC_KEY } from '../src/modules/auth/decorators/unauthenticated.decorator';
import { CreateUserDto } from '../src/modules/users/dto';

const suite = process.env.SECURITY_AUDIT_DATABASE_URL
  ? describe
  : describe.skip;
suite('Security audit diagnostics (temporary schema only)', () => {
  const schema = `security_test_${process.pid}_${Date.now()}`;
  const observations: { check: string; status: number; result: string }[] = [];
  const outputDir=process.env.SECURITY_AUDIT_OUTPUT_DIR ?? 'docs/security';
  const revokedHashes: string[] = [];
  let app: INestApplication;
  let pool: Pool;
  let prisma: PrismaService;
  let context: RequestContext;
  let jwt: JwtService;
  let monitorA: {
    id: string;
    email: string;
    role: string;
    monitor: { id: string } | null;
  };
  let monitorB: typeof monitorA;
  let supervisorA: { id: string; email: string; role: string };
  let supervisorBId: string;
  let coordinator: { id: string; email: string; role: string };
  let otherClass: string;
  let routeInventory: { method: string; path: string; public: boolean }[] = [];
  const run = <T>(work: () => T) => context.run({ schema }, work);
  const token = (
    user: { id: string; email: string; role: string } = monitorA,
    extra = {},
  ) =>
    jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      schema,
      jti: randomUUID(),
      ...extra,
    });
  const record = (check: string, status: number, result: string) =>
    observations.push({ check, status, result });

  beforeAll(async () => {
    const url = process.env.SECURITY_AUDIT_DATABASE_URL!;
    if (
      new URL(url).hostname !== 'db' ||
      !(new URL(url).pathname === '/cepre_local' || /^\/cepr_records_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
    )
      throw new Error('Audit is restricted to the local Compose database');
    pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await applyStructure(db, schema, true);
      await initialDataSchema(db, {
        emailDomain: '@example.invalid',
        createSchedules: true,
        shifts: [
          {
            name: 'Turno 01',
            startTime: '07:00',
            endTime: '12:10',
            classesToAreas: [{ area: 'Biomédicas', quantityClasses: 2 }],
          },
        ],
      });
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          NODE_ENV: 'test',
          DATABASE_URL: url,
          DB_POOL_MAX: 2,
          JWT_SECRET: 'security-audit-fixture-only-secret-32bytes',
          JWT_EXPIRES_IN: 3600,
          REDIRECT_FRONT: 'http://localhost:5173',
          GOOGLE_CLIENT_ID: 'test',
          GOOGLE_CLIENT_SECRET: 'test',
          GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/auth/google/redirect',
        }),
      )
      .overrideProvider(RuntimeConfigService)
      .useValue({
        getCurrent: () =>
          Promise.resolve({
            version: 1,
            maintenance: { enabled: false, message: '', endsAt: null },
            schemaRouting: { adminSchema: schema, userSchema: schema },
          }),
      })
      .overrideProvider(SchemaManagerService)
      .useValue({
        assertAvailable: () => Promise.resolve(),
        getCurrent: () => Promise.resolve({ name: schema }),
      })
      .overrideProvider(PermissionsService)
      .useValue({ checkPermission: () => Promise.resolve(true) })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    context = app.get(RequestContext);
    jwt = app.get(JwtService);
    await run(async () => {
      const db = prisma.getClient();
      [monitorA, monitorB] = await db.user.findMany({
        where: { role: 'monitor' },
        include: { monitor: true },
        orderBy: { email: 'asc' },
      });
      for (const user of [monitorA, monitorB])
        await db.userProfile.create({
          data: { userId: user.id, firstName: 'Audit', lastName: 'Fixture' },
        });
      const sa = await db.user.create({
        data: {
          email: 'sa@example.invalid',
          role: 'supervisor',
          supervisor: { create: { shiftId: 1 } },
        },
        include: { supervisor: true },
      });
      const sb = await db.user.create({
        data: {
          email: 'sb@example.invalid',
          role: 'supervisor',
          supervisor: { create: { shiftId: 1 } },
        },
        include: { supervisor: true },
      });
      supervisorA = sa;
      supervisorBId = sb.supervisor!.id;
      await db.monitor.update({
        where: { id: monitorA.monitor!.id },
        data: { supervisorId: sa.supervisor!.id },
      });
      await db.monitor.update({
        where: { id: monitorB.monitor!.id },
        data: { supervisorId: supervisorBId },
      });
      coordinator = await db.user.create({
        data: { email: 'coordinator@example.invalid', role: 'coordinador-1' },
      });
      otherClass = (
        await db.class.findUniqueOrThrow({
          where: { monitorId: monitorB.monitor!.id },
        })
      ).id;
      const teacher = await db.user.create({
        data: {
          email: 'teacher@example.invalid',
          role: 'profesor',
          userProfile: {
            create: {
              firstName: 'Audit',
              lastName: 'Teacher',
              dni: '00000001',
              phone: '000000000',
            },
          },
          teacher: {
            create: { courseId: 1, jobStatus: 'PartTime', maxHours: 20 },
          },
        },
        include: { teacher: true },
      });
      const block = await db.schedule.findFirstOrThrow({
        where: { classId: otherClass, courseId: 1 },
      });
      await db.schedule.update({
        where: { id: block.id },
        data: { teacherId: teacher.teacher!.id },
      });
    });
    const discovery = app.get(DiscoveryService);
    const scanner = new MetadataScanner();
    const reflector = app.get(Reflector);
    const routes: {
      method: string;
      path: string;
      public: boolean;
      authorization: unknown;
    }[] = [];
    for (const wrapper of discovery.getControllers()) {
      if (!wrapper.instance || !wrapper.metatype) continue;
      const instance = wrapper.instance as object;
      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      for (const method of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[method];
        const verb = reflector.get<number>(METHOD_METADATA, handler);
        if (verb === undefined) continue;
        routes.push({
          method: [
            'GET',
            'POST',
            'PUT',
            'DELETE',
            'PATCH',
            'ALL',
            'OPTIONS',
            'HEAD',
          ][verb],
          path: `${reflector.get<string>(PATH_METADATA, wrapper.metatype)}/${reflector.get<string>(PATH_METADATA, handler)}`
            .replace(/\/{2,}/g, '/')
            .replace(/\/$/, ''),
          public: Boolean(
            reflector.getAllAndOverride(IS_PUBLIC_KEY, [
              handler,
              wrapper.metatype,
            ]),
          ),
          authorization:
            reflector.get(AUTHORIZATION_METADATA_KEY, handler) ?? null,
        });
      }
    }
    writeFileSync(
      join(outputDir,'routes-remediation.json'),
      JSON.stringify(routes, null, 2),
    );
    routeInventory = routes;
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      if (revokedHashes.length)
        await pool.query(
          'DELETE FROM public.revoked_tokens WHERE token_hash=ANY($1::text[])',
          [revokedHashes],
        );
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
    writeFileSync(
      join(outputDir,'runtime-remediation.json'),
      JSON.stringify(
        {
          fixture:
            'temporary local schema, fictitious users; no production access',
          observations,
        },
        null,
        2,
      ),
    );
  });

  it('rejects anonymous requests across the complete protected route inventory', async () => {
    let checked = 0;
    for (const route of routeInventory.filter((item) => !item.public)) {
      const path = `/api/${route.path.replace(/:[^/]+/g, '00000000-0000-4000-8000-000000000001')}`;
      const agent = request(app.getHttpServer() as Server);
      const response = await agent[route.method.toLowerCase() as 'get'](path);
      expect(response.status).toBe(401);
      checked++;
    }
    record(
      'CONTROL protected route inventory',
      401,
      `${checked} protected operations rejected anonymous requests; Swagger is outside Nest controller guards`,
    );
  });

  it('rejects invalid DTO array entries', async () => {
    const pipe = new ParseArrayPipe({
      items: CreateUserDto,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        [{ email: 'not-an-email', role: 'not-a-role', extraProperty: true }],
        { type: 'body', metatype: Array },
      ),
    ).rejects.toThrow();
    record(
      'SEC-14 array validation',
      400,
      'fixed: invalid array elements rejected before persistence',
    );
  });

  it('denies catalog writes even when historical database permissions are permissive', async () => {
    for (const actor of [monitorA, supervisorA, coordinator]) {
      for (const method of ['post', 'put', 'delete'] as const) {
        await request(app.getHttpServer() as Server)
          [method](method === 'post' ? '/api/areas' : '/api/areas/1')
          .auth(token(actor), { type: 'bearer' })
          .send({ name: 'Forbidden' })
          .expect(401);
      }
    }
    record(
      'SEC-15 academic area mutations',
      401,
      'fixed: non-admin catalog writes rejected',
    );
  });

  it('denies other monitor profile writes and classroom reassignment without changing data', async () => {
    const before = await run(() =>
      prisma.getClient().class.findMany({ orderBy: { id: 'asc' } }),
    );
    for (const actor of [monitorA, supervisorA]) {
      await request(app.getHttpServer() as Server)
        .put('/api/monitors/' + monitorB.monitor!.id)
        .auth(token(actor), { type: 'bearer' })
        .send({
          firstName: 'Unauthorized',
          lastName: 'Change',
          classId: otherClass,
        })
        .expect(401);
    }
    expect(
      await run(() =>
        prisma.getClient().class.findMany({ orderBy: { id: 'asc' } }),
      ),
    ).toEqual(before);
    record(
      'SEC-01 monitor writes',
      401,
      'fixed: profile and classroom assignment unchanged',
    );
  });

  it('permits links only for the owning monitor and validates backend URLs', async () => {
    for (const [route, field, url] of [
      ['meet-link', 'urlMeet', 'https://meet.google.com/abc-defg-hij'],
      ['classroom-link', 'urlClassroom', 'https://classroom.google.com/c/123'],
    ]) {
      await request(app.getHttpServer() as Server)
        .patch('/api/classes/' + otherClass + '/' + route)
        .auth(token(), { type: 'bearer' })
        .send({ [field]: url })
        .expect(403);
      await request(app.getHttpServer() as Server)
        .patch('/api/classes/' + otherClass + '/' + route)
        .auth(token(supervisorA), { type: 'bearer' })
        .send({ [field]: url })
        .expect(401);
      for (const bad of [
        'javascript:alert(1)',
        'http://meet.google.com/x',
        'https://phishing.example.invalid/x',
        'https://meet.google.com@evil.invalid/',
      ]) {
        await request(app.getHttpServer() as Server)
          .patch('/api/classes/' + otherClass + '/' + route)
          .auth(token(monitorB), { type: 'bearer' })
          .send({ [field]: bad })
          .expect(400);
      }
      await request(app.getHttpServer() as Server)
        .patch('/api/classes/' + otherClass + '/' + route)
        .auth(token(monitorB), { type: 'bearer' })
        .send({ [field]: url })
        .expect(200);
      await request(app.getHttpServer() as Server)
        .patch('/api/classes/' + otherClass + '/' + route)
        .auth(token(monitorB), { type: 'bearer' })
        .send({ [field]: '' })
        .expect(200);
    }
    record(
      'SEC-02/03 classroom links',
      403,
      'fixed: owner edits work, unrelated users and unsafe URLs rejected',
    );
  });

  it('limits reads to own resources and assigned supervisors', async () => {
    for (const suffix of ['horario', 'teachers']) {
      await request(app.getHttpServer() as Server)
        .get('/api/monitors/' + monitorB.id + '/' + suffix)
        .auth(token(), { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer() as Server)
        .get('/api/monitors/' + monitorB.id + '/' + suffix)
        .auth(token(monitorB), { type: 'bearer' })
        .expect(200);
      await request(app.getHttpServer() as Server)
        .get('/api/monitors/' + monitorB.id + '/' + suffix)
        .auth(token(supervisorA), { type: 'bearer' })
        .expect(403);
    }
    await request(app.getHttpServer() as Server)
      .get('/api/supervisors/' + supervisorBId + '/monitors')
      .auth(token(supervisorA), { type: 'bearer' })
      .expect(403);
    const supervisorB = await run(() =>
      prisma.getClient().user.findFirstOrThrow({
        where: { supervisor: { id: supervisorBId } },
      }),
    );
    await request(app.getHttpServer() as Server)
      .get('/api/supervisors/' + supervisorBId + '/monitors')
      .auth(token(supervisorB), { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/api/monitors/' + monitorB.id + '/teachers')
      .auth(token(supervisorB), { type: 'bearer' })
      .expect(200);
    record(
      'SEC-04 object reads',
      403,
      'fixed: cross-owner reads rejected; assigned supervisor reads work',
    );
  });

  it('retires public DNI lookup and preserves authentication boundaries', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/schedules/public/teachers')
      .query({ email: 'teacher@example.invalid', dni: '00000001' })
      .expect(410);
    await request(app.getHttpServer() as Server)
      .get('/api/users')
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/api/classes/bulk')
      .auth(token(), { type: 'bearer' })
      .send({ area_id: 1, shift_id: 1, quantity: 1 })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get('/api/auth/user-info')
      .auth(token(monitorA, { schema: 'other_schema' }), { type: 'bearer' })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get('/api/auth/user-info')
      .auth(token(monitorA, { role: 'administrador', schema: 'core_schema' }), {
        type: 'bearer',
      })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get('/api/auth/user-info')
      .set('x-schema', schema)
      .expect(400);
    record(
      'SEC-05 public lookup',
      410,
      'fixed: no personal timetable returned without login',
    );
  });

  it('uses HttpOnly cookies, rejects CSRF and persistently revokes logged-out tokens', async () => {
    const credential = token();
    const established = await request(app.getHttpServer() as Server)
      .post('/api/auth/session')
      .auth(credential, { type: 'bearer' })
      .expect(201);
    const cookies = established.headers['set-cookie'] as unknown as string[];
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');
    const cookie = cookies[0].split(';')[0];
    await request(app.getHttpServer() as Server)
      .get('/api/auth/user-info')
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer() as Server)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://attacker.invalid')
      .set('X-Requested-With', 'ceprunsa')
      .expect(403);
    revokedHashes.push(createHash('sha256').update(credential).digest('hex'));
    await request(app.getHttpServer() as Server)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'ceprunsa')
      .expect(201);
    await request(app.getHttpServer() as Server)
      .get('/api/auth/user-info')
      .auth(credential, { type: 'bearer' })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get('/api/auth/user-info')
      .set('Cookie', cookie)
      .expect(401);
    record(
      'SEC-07/08 sessions',
      401,
      'fixed: cookie CSRF enforced and copied logged-out token rejected',
    );
  });
});
