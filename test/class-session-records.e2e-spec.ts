import { BadRequestException, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { RequestContext } from '../src/database/schema-manager/request-context';
import { TokenRevocationService } from '../src/modules/auth/token-revocation.service';
import type { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { applyStructure } from '../src/database/prisma/structure';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { Server } from 'http';
import request from 'supertest';
import { Prisma, ClassSessionRecord } from '../src/generated/prisma/client';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { SchemaManagerInterceptor } from '../src/database/schema-manager/schema-manager.interceptor';
import { PrismaExceptionInterceptor } from '../src/database/prisma/interceptors/exception.interceptor';
import { RuntimeConfigService } from '../src/modules/runtime-config/runtime-config.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { AuthGlobalGuard } from '../src/modules/auth/guards/auth-global.guard';
import { AuthorizationGuard } from '../src/modules/auth/guards/authorization.guard';
import { PermissionsService } from '../src/modules/permissions/permissions.service';
import { ClassSessionRecordsController } from '../src/modules/class-session-records/class-session-records.controller';
import { ClassSessionRecordsService } from '../src/modules/class-session-records/class-session-records.service';
import {
  SessionJournalService,
  limaDate,
} from '../src/modules/class-session-records/session-journal.service';
import { SessionFollowupService } from '../src/modules/class-session-records/session-followup.service';
import { SessionReportsService } from '../src/modules/class-session-records/session-reports.service';
import { SessionPrincipal } from '../src/modules/class-session-records/session.types';
import { SessionFilesFixture } from './helpers/session-files-fixtures';
import { initialDataSchema } from '../src/database/prisma/data/seed';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('Partes integrados (JWT + guards + PostgreSQL)', () => {
  jest.setTimeout(120000);
  const fixture = new SessionFilesFixture();
  const als = fixture.context;
  const secret = 'records-test-only';
  const jwt = new JwtService({ secret });
  let app: INestApplication;
  let records: ClassSessionRecordsService;
  let journal: SessionJournalService;
  let followup: SessionFollowupService;
  let routing: { adminSchema: string; userSchema: string };
  const monitorId = randomUUID(),
    otherMonitorId = randomUUID();
  const teacherIds = [randomUUID(), randomUUID(), randomUUID()];
  const teacherUsers = [randomUUID(), randomUUID(), randomUUID()];
  const otherClass = randomUUID();
  const actor = (name = 'monitor') => fixture.principals[name];
  const token = (
    name = 'monitor',
    overrides: Partial<SessionPrincipal & { schema: string | undefined }> = {},
  ) => {
    const p = { ...actor(name), ...overrides };
    return jwt.sign(
      {
        id: p.userId,
        email: p.email,
        role: p.role,
        schema: name === 'admin' ? 'core_schema' : fixture.schema,
        ...overrides,
      },
      { expiresIn: '1h', issuer: 'cepr', audience: 'cepr-api' },
    );
  };
  const api = (
    method: 'get' | 'post' | 'patch',
    path: string,
    name = 'monitor',
  ) =>
    request(app.getHttpServer() as Server)
      [method](`/class-session-records${path}`)
      .auth(token(name), { type: 'bearer' });
  const run = <T>(callback: () => Promise<T>) =>
    als.run({ schema: fixture.schema, routing }, callback);
  const db = () => fixture.client();
  const body = <T>(res: request.Response) => res.body as T;
  const fresh = async () => {
    const r = await fixture.record();
    return db().classSessionRecord.update({
      where: { id: r.id },
      data: {
        titularMonitorId: monitorId,
        titularTeacherId: teacherIds[0],
        timingPolicy: {
          latenessToleranceMinutes: 5,
          continuityGapMinutes: 10,
          alertThresholdMinutes: 0,
          replacementWaitMinutes: 7,
        },
      },
    });
  };
  const patch = (
    r: ClassSessionRecord,
    data: Record<string, unknown> = {},
    name = 'monitor',
  ) =>
    api('patch', `/${r.id}`, name).send({
      expectedVersion: r.version,
      ...data,
    });

  beforeAll(async () => {
    await fixture.initialize();
    routing = { adminSchema: fixture.schema, userSchema: fixture.schema };
    await db().shift.update({
      where: { id: 1 },
      data: {
        startTime: new Date('1970-01-01T00:00:00Z'),
        endTime: new Date('1970-01-01T23:59:00Z'),
      },
    });
    await db().course.create({ data: { id: 2, name: 'Other course' } });
    await db().monitor.createMany({
      data: [
        {
          id: monitorId,
          userId: actor().userId,
          supervisorId: fixture.supervisorId,
        },
        {
          id: otherMonitorId,
          userId: actor('otherMonitor').userId,
          supervisorId: fixture.supervisorId,
        },
      ],
    });
    await db().class.update({
      where: { id: fixture.classId },
      data: { monitorId },
    });
    await db().class.create({
      data: {
        id: otherClass,
        name: 'Other class',
        idSede: 1,
        areaId: 1,
        shiftId: 1,
        monitorId: otherMonitorId,
      },
    });
    for (let i = 0; i < 3; i++) {
      await db().user.create({
        data: {
          id: teacherUsers[i],
          email: `replacement${i}@test.invalid`,
          role: 'profesor',
        },
      });
      await db().teacher.create({
        data: {
          id: teacherIds[i],
          userId: teacherUsers[i],
          courseId: i === 2 ? 2 : 1,
          jobStatus: 'PartTime',
        },
      });
    }
    const config = new ConfigService({
      CORE_SCHEMA: fixture.coreSchema,
      JWT_SECRET: secret,
      CLASS_RECORDS_TASK_ENABLED: 'false',
    });
    const runtime = {
      getCurrent: () =>
        Promise.resolve({
          schemaRouting: routing,
          maintenance: { enabled: false },
        }),
    };
    const schemas = {
      assertAvailable: () => Promise.resolve(),
      getCurrent: () => Promise.resolve({ name: fixture.schema }),
      schemaExists: (s: string) =>
        Promise.resolve(
          [fixture.schema, fixture.otherSchema, fixture.coreSchema].includes(s),
        ),
      getAllWithCache: () =>
        Promise.resolve([
          { name: fixture.schema },
          { name: fixture.otherSchema },
          { name: fixture.coreSchema },
        ]),
    };
    const module = await Test.createTestingModule({
      controllers: [ClassSessionRecordsController],
      providers: [
        ClassSessionRecordsService,
        SessionJournalService,
        SessionFollowupService,
        SessionReportsService,
        JwtStrategy,
        JwtAuthGuard,
        AuthorizationGuard,
        AuthGlobalGuard,
        SchemaManagerInterceptor,
        PrismaExceptionInterceptor,
        {
          provide: PrismaService,
          useValue: fixture.apiPrisma,
        },
        { provide: RequestContext, useValue: als },
        {
          provide: TokenRevocationService,
          useValue: { assertActive: () => Promise.resolve() },
        },
        { provide: ConfigService, useValue: config },
        { provide: RuntimeConfigService, useValue: runtime },
        { provide: SchemaManagerService, useValue: schemas },
        {
          provide: PermissionsService,
          useValue: { checkPermission: () => Promise.resolve(true) },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if ('x-schema' in req.headers)
        return next(new BadRequestException('Selección de esquema prohibida'));
      als.run({}, next);
    });
    app.useGlobalGuards(module.get(AuthGlobalGuard));
    app.useGlobalInterceptors(
      module.get(SchemaManagerInterceptor),
      module.get(PrismaExceptionInterceptor),
    );
    await app.init();
    records = module.get(ClassSessionRecordsService);
    journal = module.get(SessionJournalService);
    followup = module.get(SessionFollowupService);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    routing = { adminSchema: fixture.schema, userSchema: fixture.schema };
  });
  afterAll(async () => {
    await app?.close();
    await fixture.close();
  });

  it('expone cuenta, proceso validado y reloj sin caché; admin usa runtime y no su JWT core', async () => {
    for (const role of ['monitor', 'supervisor', 'admin']) {
      const response = await api('get', '/context', role).expect(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const context = body<{
        accountId: string;
        process: string;
        serverNow: string;
      }>(response);
      expect(Object.keys(context).sort()).toEqual([
        'accountId',
        'process',
        'serverNow',
      ]);
      expect(context.accountId).toBe(actor(role).userId);
      expect(context.process).toBe(fixture.schema);
      expect(Math.abs(+new Date(context.serverNow) - Date.now())).toBeLessThan(
        5000,
      );
    }
    routing = { adminSchema: fixture.otherSchema, userSchema: fixture.schema };
    expect(
      body<{ process: string }>(
        await api('get', '/context', 'admin').expect(200),
      ).process,
    ).toBe(fixture.otherSchema);
    expect(
      body<{ process: string }>(await api('get', '/context').expect(200))
        .process,
    ).toBe(fixture.schema);
    for (const role of ['teacher', 'coordinator'])
      await api('get', '/context', role).expect(401);
    await request(app.getHttpServer() as Server)
      .get('/class-session-records/context')
      .expect(401);
    await api('get', `/context?process=${fixture.otherSchema}`).expect(400);
    await api('get', '/context')
      .set('x-schema', fixture.otherSchema)
      .expect(400);
    routing.userSchema = fixture.otherSchema;
    await api('get', '/context').expect(401);
    routing.adminSchema = 'public';
    await api('get', '/context', 'admin').expect(403);
  });
  it('no entrega contexto a una cuenta desactivada', async () => {
    await db().user.update({
      where: { id: actor('otherMonitor').userId },
      data: { isActive: false },
    });
    try {
      await api('get', '/context', 'otherMonitor').expect(401);
    } finally {
      await db().user.update({
        where: { id: actor('otherMonitor').userId },
        data: { isActive: true },
      });
    }
  });
  it('trata X-Class-Session-Context como precondición opcional y exceptúa recuperar contexto', async () => {
    const r = await fresh();
    for (const role of ['monitor', 'supervisor', 'admin']) {
      await api('get', `/${r.id}`, role).expect(200);
      await api('get', `/${r.id}`, role)
        .set('X-Class-Session-Context', fixture.schema)
        .expect(200);
      const mismatch = await api('get', `/${r.id}`, role)
        .set('X-Class-Session-Context', fixture.otherSchema)
        .expect(409);
      expect(body<{ code: string }>(mismatch).code).toBe(
        'CLASS_SESSION_CONTEXT_CHANGED',
      );
      expect(
        body<{ process: string }>(
          await api('get', '/context', role)
            .set('X-Class-Session-Context', fixture.otherSchema)
            .expect(200),
        ).process,
      ).toBe(fixture.schema);
    }
    await api('get', `/${r.id}`, 'admin')
      .set('X-Class-Session-Context', 'core_schema')
      .expect(409);
    await api('get', `/${r.id}`, 'admin')
      .set('X-Class-Session-Context', '')
      .expect(409);
    await api('get', `/${r.id}`, 'admin')
      .set('X-Class-Session-Context', fixture.schema)
      .set('x-schema', fixture.otherSchema)
      .expect(400);
  });
  it('usa JWT real, contexto HTTP y cuenta monitor; rechaza salón ajeno e identidad ausente', async () => {
    const r = await fresh();
    await api('get', `/${r.id}`).expect(200);
    await api('get', `/${r.id}`, 'otherMonitor').expect(404);
    await request(app.getHttpServer() as Server)
      .get(`/class-session-records/${r.id}`)
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get(`/class-session-records/${r.id}`)
      .auth(token('monitor', { schema: undefined }), { type: 'bearer' })
      .expect(401);
  });
  it('bloquea cuenta esperada distinta antes de consultas/escrituras aunque coincidan rol y proceso', async () => {
    const r = await fresh();
    const secondAdmin = await fixture.client(fixture.coreSchema).user.create({
      data: { email: 'second-admin@test.invalid', role: 'administrador' },
    });
    const credential = token('admin', {
      userId: secondAdmin.id,
      email: secondAdmin.email,
    });
    const asSecond = (method: 'get' | 'post', path: string) =>
      request(app.getHttpServer() as Server)
        [method](`/class-session-records${path}`)
        .auth(credential, { type: 'bearer' });
    const operationalContext = jest.spyOn(records, 'context');
    for (const path of [
      `/${r.id}`,
      `/${r.id}/history`,
      `/${r.id}/people?kind=TEACHER`,
      '/configuration',
    ]) {
      const blocked = await asSecond('get', path)
        .set('X-Class-Session-Context', fixture.schema)
        .set('X-Class-Session-Account', actor('admin').userId)
        .expect(409);
      expect(body<{ code: string }>(blocked).code).toBe(
        'CLASS_SESSION_CONTEXT_CHANGED',
      );
    }
    await asSecond('post', `/${r.id}/corrections`)
      .set('X-Class-Session-Context', fixture.schema)
      .set('X-Class-Session-Account', actor('admin').userId)
      .send({
        expectedVersion: 1,
        incidents: 'Intención del administrador previo',
        reason: 'Debe rechazarse por cambio de cuenta',
      })
      .expect(409);
    await api('patch', `/${r.id}`)
      .set('X-Class-Session-Account', actor('admin').userId)
      .send({ expectedVersion: 1, incidents: 'Intención de otra cuenta' })
      .expect(409);
    expect(operationalContext).not.toHaveBeenCalled();
    operationalContext.mockRestore();
    expect(
      (await db().classSessionRecord.findUniqueOrThrow({ where: { id: r.id } }))
        .version,
    ).toBe(1);
    expect(
      await db().sessionAuditEvent.count({ where: { recordId: r.id } }),
    ).toBe(0);
    const recovered = body<{ accountId: string; process: string }>(
      await asSecond('get', '/context')
        .set('X-Class-Session-Account', actor('admin').userId)
        .expect(200),
    );
    expect(recovered).toMatchObject({
      accountId: secondAdmin.id,
      process: fixture.schema,
    });
    await asSecond('get', `/${r.id}`).expect(200);
    await asSecond('post', `/${r.id}/corrections`)
      .set('X-Class-Session-Context', fixture.schema)
      .set('X-Class-Session-Account', secondAdmin.id)
      .send({
        expectedVersion: 1,
        incidents: 'Cuenta nueva confirmada',
        reason: 'Intención explícita de la cuenta actual',
      })
      .expect(201);
    const audit = await db().sessionAuditEvent.findFirstOrThrow({
      where: { recordId: r.id },
    });
    expect(audit.actor).toEqual(
      expect.objectContaining({ id: secondAdmin.id }),
    );
    for (const role of ['monitor', 'supervisor', 'admin'])
      await api('get', `/${r.id}`, role)
        .set('X-Class-Session-Account', actor(role).userId)
        .expect(200);
    await api('get', `/${r.id}`).set('X-Class-Session-Account', '').expect(409);
  });
  it('supervisa monitores de turnos distintos y rechaza supervisor ajeno', async () => {
    const r = await fresh();
    await db().shift.create({ data: { id: 2, name: 'Second shift' } });
    const r2 = await fresh();
    await db().classSessionRecord.update({
      where: { id: r2.id },
      data: {
        shiftId: 2,
        monitorAccountId: actor('otherMonitor').userId,
        titularMonitorId: otherMonitorId,
      },
    });
    await api('get', `/${r.id}`, 'supervisor').expect(200);
    await api('get', `/${r2.id}`, 'supervisor').expect(200);
    await api('get', `/${r.id}`, 'otherSupervisor').expect(404);
  });
  it('ofrece solo identidad operativa de personas activas y docentes del curso del parte', async () => {
    const r = await fresh();
    await db().userProfile.create({
      data: {
        userId: teacherUsers[0],
        firstName: 'Ana Catalogo',
        lastName: 'Prueba',
        dni: '12345678',
        phone: '999999999',
        phonesAdditional: ['888888888'],
        personalEmail: 'privado@test.invalid',
      },
    });
    await db().user.create({
      data: {
        email: 'inactive-teacher@test.invalid',
        role: 'profesor',
        isActive: false,
        teacher: { create: { courseId: 1, jobStatus: 'PartTime' } },
      },
    });
    const response = body<{
      data: { id: string; name: string; email: string }[];
      total: number;
    }>(await api('get', `/${r.id}/people?kind=TEACHER`).expect(200));
    expect(response.total).toBe(2);
    expect(response.data.map((p) => p.id).sort()).toEqual(
      teacherIds.slice(0, 2).sort(),
    );
    for (const person of response.data)
      expect(Object.keys(person).sort()).toEqual(['email', 'id', 'name']);
    expect(
      body<unknown>(
        await api(
          'get',
          `/${r.id}/people?kind=TEACHER&search=cATALOGO&limit=1`,
        ).expect(200),
      ),
    ).toEqual({
      data: [
        {
          id: teacherIds[0],
          name: 'Ana Catalogo Prueba',
          email: 'replacement0@test.invalid',
        },
      ],
      total: 1,
      page: 1,
      limit: 1,
    });
    expect(
      body<{ data: unknown[]; total: number }>(
        await api(
          'get',
          `/${r.id}/people?kind=TEACHER&search=CATALOGO&limit=1&page=2`,
        ).expect(200),
      ),
    ).toMatchObject({ data: [], total: 1 });
    await db().user.create({
      data: {
        email: 'inactive-monitor@test.invalid',
        role: 'monitor',
        isActive: false,
        monitor: { create: {} },
      },
    });
    const monitors = body<{ data: { id: string }[]; total: number }>(
      await api('get', `/${r.id}/people?kind=MONITOR`).expect(200),
    );
    expect(monitors.total).toBe(2);
    expect(monitors.data.map((p) => p.id).sort()).toEqual(
      [monitorId, otherMonitorId].sort(),
    );
  });
  it('limita el catálogo al recurso autorizado sin depender de permisos generales de personas', async () => {
    const r = await fresh();
    jest
      .spyOn(app.get(PermissionsService), 'checkPermission')
      .mockResolvedValue(false);
    for (const role of ['monitor', 'supervisor', 'admin'])
      await api('get', `/${r.id}/people?kind=TEACHER`, role).expect(200);
    for (const role of ['otherMonitor', 'otherSupervisor'])
      await api('get', `/${r.id}/people?kind=TEACHER`, role).expect(404);
    for (const role of ['teacher', 'coordinator'])
      await api('get', `/${r.id}/people?kind=TEACHER`, role).expect(401);
    await request(app.getHttpServer() as Server)
      .get(`/class-session-records/${r.id}/people?kind=TEACHER`)
      .expect(401);
    await api('get', `/${r.id}/people?kind=MONITOR`)
      .set('x-schema', fixture.otherSchema)
      .expect(400);
    routing = {
      adminSchema: fixture.otherSchema,
      userSchema: fixture.otherSchema,
    };
    await api('get', `/${r.id}/people?kind=TEACHER`).expect(401);
    await api('get', `/${r.id}/people?kind=TEACHER`, 'admin').expect(404);
  });
  it('valida tipo, búsqueda y paginación del catálogo; consultarlo no reabre ni modifica un parte', async () => {
    const r = await fresh();
    for (const query of [
      '',
      'kind=OTHER',
      'kind=TEACHER&limit=101',
      'kind=TEACHER&page=0',
      `kind=TEACHER&search=${'x'.repeat(101)}`,
      'kind=TEACHER&courseId=2',
      `kind=TEACHER&schema=${fixture.otherSchema}`,
    ])
      await api('get', `/${r.id}/people?${query}`).expect(400);
    await fixture.closeRecord(r.id);
    await api('get', `/${r.id}/people?kind=MONITOR`).expect(200);
    expect(
      (await db().classSessionRecord.findUniqueOrThrow({ where: { id: r.id } }))
        .version,
    ).toBe(r.version);
    await patch(r, { incidents: 'Sigue cerrado' }).expect(403);
    await api('post', `/${r.id}/cancel`, 'admin')
      .send({
        expectedVersion: r.version,
        reason: 'Anular después de consulta',
      })
      .expect(201);
    await api('get', `/${r.id}/people?kind=MONITOR`).expect(404);
    await api('get', `/${r.id}/people?kind=MONITOR`, 'admin').expect(200);
  });
  it('bloquea profesor/coordinador con todos los permisos globales, también historial y reportes', async () => {
    const r = await fresh();
    for (const name of ['teacher', 'coordinator'])
      for (const path of [
        `/${r.id}`,
        `/${r.id}/history`,
        '/reports/detail?from=2026-01-01&to=2026-01-31',
        '/alerts',
      ])
        await api('get', path, name).expect(401);
    await api('get', `/${r.id}`)
      .set('x-schema', fixture.otherSchema)
      .expect(400);
    await patch(r, { incidents: 'x' }, 'supervisor').expect(401);
  });
  it('impide lectura/escritura con contexto admin obsoleto e IDs coincidentes; conserva clientes sin header', async () => {
    const r = await fresh();
    const originalContext = body<{ process: string }>(
      await api('get', '/context', 'admin').expect(200),
    );
    const other = fixture.client(fixture.otherSchema);
    await other.$executeRaw`INSERT INTO areas(id,name) VALUES(1,'Area')`;
    await other.$executeRaw`INSERT INTO courses(id,name) VALUES(1,'Course')`;
    await other.$executeRaw`INSERT INTO sedes(id,name) VALUES(1,'Sede')`;
    await other.$executeRaw`INSERT INTO shifts(id,name) VALUES(1,'Shift')`;
    await other.$executeRaw`INSERT INTO hour_sessions(id,shift_id,period,start_time,end_time) VALUES(1,1,1,'08:00','08:40')`;
    await other.$executeRaw`INSERT INTO classes(id,name,id_sede,area_id,shift_id) VALUES(${fixture.classId}::uuid,'Class',1,1,1)`;
    await other.classSessionRecord.create({
      data: {
        ...r,
        titularTeacherId: null,
        titularMonitorId: null,
        supervisorId: null,
        snapshot: {},
        effectiveSnapshot: {},
        timingPolicy: {},
        initialAssociatedBy: Prisma.DbNull,
        finalAssociatedBy: Prisma.DbNull,
        deletedBy: Prisma.DbNull,
      },
    });
    routing = {
      adminSchema: fixture.otherSchema,
      userSchema: fixture.otherSchema,
    };
    const operationalContext = jest.spyOn(records, 'context');
    const date = r.date.toISOString().slice(0, 10);
    for (const path of [
      `/${r.id}`,
      `/${r.id}/history`,
      `/${r.id}/people?kind=TEACHER`,
      `?from=${date}&to=${date}`,
      `/agenda?date=${date}`,
      '/alerts',
      `/reports/detail?from=${date}&to=${date}`,
      `/reports/summary?from=${date}&to=${date}`,
      '/configuration',
    ])
      await api('get', path, 'admin')
        .set('X-Class-Session-Context', originalContext.process)
        .expect(409);
    await api('post', `/${r.id}/corrections`, 'admin')
      .set('X-Class-Session-Context', originalContext.process)
      .send({
        expectedVersion: 1,
        incidents: 'No debe cruzar de proceso',
        reason: 'Petición basada en contexto antiguo',
      })
      .expect(409);
    expect(operationalContext).not.toHaveBeenCalled();
    operationalContext.mockRestore();
    expect(
      (
        await other.classSessionRecord.findUniqueOrThrow({
          where: { id: r.id },
        })
      ).version,
    ).toBe(1);
    expect(
      await other.sessionAuditEvent.count({ where: { recordId: r.id } }),
    ).toBe(0);
    expect(
      (await db().classSessionRecord.findUniqueOrThrow({ where: { id: r.id } }))
        .version,
    ).toBe(1);
    expect(
      body<{ process: string }>(
        await api('get', '/context', 'admin')
          .set('X-Class-Session-Context', originalContext.process)
          .expect(200),
      ).process,
    ).toBe(fixture.otherSchema);
    await api('get', `/${r.id}`, 'admin')
      .set('X-Class-Session-Context', fixture.otherSchema)
      .expect(200);
    await api('get', `/${r.id}`).expect(401);
    const corrected = body<ClassSessionRecord>(
      await api('post', `/${r.id}/corrections`, 'admin')
        .send({
          expectedVersion: 1,
          incidents: 'Cambio aislado',
          reason: 'Corrección excepcional',
        })
        .expect(201),
    );
    expect(corrected.incidents).toBe('Cambio aislado');
    expect(
      (await db().classSessionRecord.findUniqueOrThrow({ where: { id: r.id } }))
        .incidents,
    ).toBeNull();
    expect(
      await other.user.findUnique({ where: { id: actor('admin').userId } }),
    ).toBeNull();
    const event = await other.sessionAuditEvent.findFirstOrThrow({
      where: { recordId: r.id },
    });
    expect(event.actor).toEqual(
      expect.objectContaining({
        origin: 'core_schema',
        id: actor('admin').userId,
      }),
    );
  });
  it('impide sobreescrituras concurrentes y audita antes/después en una transacción', async () => {
    const r = await fresh();
    const responses = await Promise.all([
      patch(r, { incidents: 'A' }),
      patch(r, { incidents: 'B' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = await db().classSessionRecord.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(current.version).toBe(2);
    const events = await db().sessionAuditEvent.findMany({
      where: { recordId: r.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].before).toEqual(expect.objectContaining({ version: 1 }));
    expect(events[0].after).toEqual(expect.objectContaining({ version: 2 }));
    expect(events[0].actor).toEqual(
      expect.objectContaining({ id: actor().userId, origin: fixture.schema }),
    );
  });
  it('revierte todo si falla guardar auditoría y revalida reloj al final de la operación', async () => {
    const r = await fresh();
    const auditSpy = jest
      .spyOn(records, 'audit')
      .mockImplementationOnce(() =>
        Promise.reject(new Error('audit unavailable')),
      );
    await expect(
      run(() =>
        records.update(actor(), r.id, {
          expectedVersion: 1,
          incidents: 'No persistir',
        }),
      ),
    ).rejects.toThrow('audit unavailable');
    expect(
      (await db().classSessionRecord.findUniqueOrThrow({ where: { id: r.id } }))
        .version,
    ).toBe(1);
    auditSpy.mockRestore();
    await expect(
      run(() =>
        records.mutate(actor(), r.id, 1, 'SLOW', undefined, async (tx) => {
          await tx.$executeRaw`UPDATE class_session_records SET shift_end=clock_timestamp()-interval '90 minutes',edit_deadline=clock_timestamp() WHERE id=${r.id}`;
          return { incidents: 'No persistir' };
        }),
      ),
    ).rejects.toThrow();
    expect(
      (await db().classSessionRecord.findUniqueOrThrow({ where: { id: r.id } }))
        .incidents,
    ).toBeNull();
  });
  it('cierra al límite exacto y después; concede, vence y revoca habilitaciones sin mover plazo', async () => {
    const r = await fresh();
    await patch(r, { incidents: 'Antes' }).expect(200);
    await fixture.closeRecord(r.id);
    await api('patch', `/${r.id}`)
      .send({ expectedVersion: 2, incidents: 'Después' })
      .expect(403);
    const closed = await db().classSessionRecord.findUniqueOrThrow({
      where: { id: r.id },
    });
    jest.spyOn(records, 'now').mockResolvedValueOnce(closed.editDeadline);
    await expect(
      db().$transaction((tx) =>
        records.assertWritable(
          tx,
          {
            id: actor().userId,
            email: actor().email,
            origin: fixture.schema,
            schema: fixture.schema,
            role: 'monitor' as never,
          },
          closed,
        ),
      ),
    ).rejects.toThrow('Plazo cerrado');
    jest.restoreAllMocks();
    const grant = body<{ id: number }>(
      await api('post', `/${r.id}/grants`, 'admin')
        .send({
          expectedVersion: 2,
          accountId: actor().userId,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          reason: 'Completar evidencia',
        })
        .expect(201),
    );
    await api('patch', `/${r.id}`)
      .send({ expectedVersion: 2, incidents: 'Habilitado' })
      .expect(200);
    await api('post', `/grants/${grant.id}/revoke`, 'admin')
      .send({ expectedVersion: 3, reason: 'Revocación solicitada' })
      .expect(201);
    await api('patch', `/${r.id}`)
      .send({ expectedVersion: 3, incidents: 'Revocado' })
      .expect(403);
    await db().sessionEditGrant.create({
      data: {
        recordId: r.id,
        accountId: actor().userId,
        createdAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 60000),
        reason: 'Ya vencida',
        grantedBy: {},
      },
    });
    await api('patch', `/${r.id}`).send({ expectedVersion: 3 }).expect(403);
    expect(
      (await db().classSessionRecord.findUniqueOrThrow({ where: { id: r.id } }))
        .editDeadline,
    ).toEqual(closed.editDeadline);
    await api('post', `/${r.id}/grants`, 'admin')
      .send({
        expectedVersion: 3,
        accountId: actor('teacher').userId,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        reason: 'No permitido',
      })
      .expect(400);
  });
  it('el trigger PostgreSQL rechaza escritura que cruza el cierre, aunque la validación previa haya pasado', async () => {
    const r = await fresh();
    await db()
      .$executeRaw`UPDATE class_session_records SET scheduled_start=clock_timestamp()-interval '3 hours',scheduled_end=clock_timestamp()-interval '2 hours',shift_end=clock_timestamp()-interval '90 minutes'+interval '200 milliseconds',edit_deadline=clock_timestamp()+interval '200 milliseconds' WHERE id=${r.id}`;
    await expect(
      db().$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('cepr.session_account',${actor().userId},true)`;
        await tx.$queryRaw`SELECT pg_sleep(0.3)::text`;
        await tx.classSessionRecord.update({
          where: { id: r.id },
          data: { incidents: 'Tarde' },
        });
      }),
    ).rejects.toThrow('SESSION_EDIT_CLOSED');
  });
  it('cobertura individual/masiva por aulas, mismo curso, conflictos y ausencia conservada', async () => {
    const r = await fresh(),
      r2 = await fresh();
    await db().classSessionRecord.update({
      where: { id: r2.id },
      data: {
        classId: otherClass,
        scheduledStart: new Date(+r.scheduledStart + 3600000),
        scheduledEnd: new Date(+r.scheduledEnd + 3600000),
        shiftEnd: new Date(+r.shiftEnd + 3600000),
        editDeadline: new Date(+r.editDeadline + 3600000),
      },
    });
    await api('post', '/replacements', 'admin')
      .send({
        targets: [{ recordId: r.id, expectedVersion: 1 }],
        kind: 'TEACHER',
        personId: teacherIds[2],
        mode: 'PLANNED',
        reason: 'Otro curso',
      })
      .expect(400);
    const result = body<{ operationId: string; data: { id: number }[] }>(
      await api('post', '/replacements', 'admin')
        .send({
          targets: [
            { recordId: r.id, expectedVersion: 1 },
            { recordId: r2.id, expectedVersion: 1 },
          ],
          kind: 'TEACHER',
          personId: teacherIds[1],
          mode: 'EMERGENCY',
          reason: 'Inasistencia titular',
        })
        .expect(201),
    );
    expect(result.data).toHaveLength(2);
    expect(result.operationId[14]).toBe('7');
    const current = await db().classSessionRecord.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(current.effectiveTeacherId).toBeNull();
    expect(current.titularOutcome).toBe('UNKNOWN');
    await patch(current, {
      effectiveTeacherId: teacherIds[1],
      effectiveMonitorId: monitorId,
      titularOutcome: 'ABSENT',
      teachingStatus: 'TAUGHT',
      actualStart: r.scheduledStart.toISOString(),
      actualEnd: r.scheduledEnd.toISOString(),
    }).expect(200);
    const after = await db().classSessionRecord.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(after.titularOutcome).toBe('ABSENT');
    expect(after.titularTeacherId).toBe(teacherIds[0]);
    expect(
      (await db().teacher.findUniqueOrThrow({ where: { id: teacherIds[0] } }))
        .scheduledHours,
    ).toBe(0);
    await api('post', '/replacements', 'admin')
      .send({
        targets: [{ recordId: r.id, expectedVersion: 3 }],
        kind: 'TEACHER',
        personId: teacherIds[1],
        mode: 'PLANNED',
        reason: 'Ya existe',
      })
      .expect(409);
  });
  it('solicitud de emergencia pendiente y resolución no reescriben trabajo ocurrido', async () => {
    const r = await fresh();
    const result = body<{ data: { id: number; status: string }[] }>(
      await api('post', '/replacements')
        .send({
          targets: [{ recordId: r.id, expectedVersion: 1 }],
          kind: 'TEACHER',
          personId: teacherIds[1],
          mode: 'EMERGENCY',
          reason: 'Emergencia declarada',
        })
        .expect(201),
    );
    expect(result.data[0].status).toBe('PENDING');
    await api('patch', `/${r.id}`)
      .send({
        expectedVersion: 2,
        effectiveTeacherId: teacherIds[1],
        titularOutcome: 'ABSENT',
      })
      .expect(200);
    await api('post', `/replacements/${result.data[0].id}/resolve`, 'admin')
      .send({ expectedVersion: 3, status: 'REJECTED', reason: 'No autorizada' })
      .expect(201);
    const current = await db().classSessionRecord.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(current.effectiveTeacherId).toBe(teacherIds[1]);
    expect(current.titularOutcome).toBe('ABSENT');
    await api('post', '/replacements')
      .send({
        targets: [{ recordId: r.id, expectedVersion: 4 }],
        kind: 'MONITOR',
        personId: otherMonitorId,
        mode: 'PLANNED',
        reason: 'Monitor no autoriza',
      })
      .expect(400);
  });
  it('serializa coberturas concurrentes sin duplicación activa ni conflictos entre aulas', async () => {
    const r = await fresh();
    const data = {
      targets: [{ recordId: r.id, expectedVersion: 1 }],
      kind: 'MONITOR',
      personId: otherMonitorId,
      mode: 'PLANNED',
      reason: 'Cobertura simultánea',
    };
    const responses = await Promise.all([
      api('post', '/replacements', 'admin').send(data),
      api('post', '/replacements', 'admin').send(data),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db().sessionCoverage.count({
        where: { recordId: r.id, status: 'AUTHORIZED' },
      }),
    ).toBe(1);
  });
  it('revisión del supervisor titular, después del cierre, queda histórica tras nueva versión', async () => {
    const r = await fresh();
    await fixture.closeRecord(r.id);
    await api('post', `/${r.id}/reviews`, 'otherSupervisor')
      .send({ expectedVersion: 1, result: 'OBSERVED', confirmed: true })
      .expect(404);
    await api('post', `/${r.id}/reviews`, 'supervisor')
      .send({
        expectedVersion: 1,
        result: 'OBSERVED',
        comments: 'Falta evidencia',
        confirmed: true,
      })
      .expect(201);
    expect(
      body<{ reviewStatus: string }>(await api('get', `/${r.id}`, 'supervisor'))
        .reviewStatus,
    ).toBe('OBSERVED');
    await api('post', `/${r.id}/corrections`, 'admin')
      .send({
        expectedVersion: 1,
        incidents: 'Corrección extraordinaria',
        reason: 'Aclarar incidencia',
      })
      .expect(201);
    const detail = body<{
      reviewStatus: string;
      reviews: { recordVersion: number }[];
    }>(await api('get', `/${r.id}`, 'supervisor'));
    expect(detail.reviewStatus).toBe('PENDING');
    expect(detail.reviews.map((v) => v.recordVersion)).toContain(1);
    await api('patch', `/${r.id}`).send({ expectedVersion: 2 }).expect(403);
  });
  it('anula/restaura lógicamente sin eludir unicidad ni plazo', async () => {
    const r = await fresh();
    await fixture.closeRecord(r.id);
    await api('post', `/${r.id}/cancel`, 'admin')
      .send({ expectedVersion: 1, reason: 'Registro anulado' })
      .expect(201);
    await api('get', `/${r.id}`).expect(404);
    await expect(
      db().classSessionRecord.create({
        data: {
          ...r,
          id: undefined,
          snapshot: {},
          timingPolicy: {},
          effectiveSnapshot: {},
          initialAssociatedBy: Prisma.DbNull,
          finalAssociatedBy: Prisma.DbNull,
          deletedBy: Prisma.DbNull,
        },
      }),
    ).rejects.toThrow();
    await api('post', `/${r.id}/restore`, 'admin')
      .send({ expectedVersion: 2, reason: 'Restaurar registro' })
      .expect(201);
    await api('patch', `/${r.id}`).send({ expectedVersion: 3 }).expect(403);
    await expect(
      db().classSessionRecord.delete({ where: { id: r.id } }),
    ).rejects.toThrow('retained');
  });
  it('jornada idempotente antes de ejecución, no reconstruye pasado; alerta persistente sin intervención monitor', async () => {
    const now = new Date();
    const future = new Date(+now + 3600000);
    if (limaDate(future) !== limaDate(now)) future.setTime(+now + 60000);
    const time = new Date(
      `1970-01-01T${new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(future)}Z`,
    );
    const hour = await db().hourSession.create({
      data: {
        shiftId: 1,
        period: 10,
        startTime: time,
        endTime: new Date(+time + 60000),
      },
    });
    const weekday = [
      'Domingo',
      'Lunes',
      'Martes',
      'Miercoles',
      'Jueves',
      'Viernes',
      'Sabado',
    ][new Date(limaDate()).getUTCDay()] as never;
    await db().schedule.create({
      data: {
        classId: fixture.classId,
        hourSessionId: hour.id,
        courseId: 1,
        teacherId: teacherIds[0],
        weekday,
      },
    });
    await db().sessionOperationalConfig.update({
      where: { id: 1 },
      data: {
        enabled: true,
        startsOn: new Date(limaDate()),
        endsOn: new Date(limaDate()),
        alertThresholdMinutes: 0,
        latenessToleranceMinutes: 5,
        continuityGapMinutes: 10,
      },
    });
    const results = await Promise.all([
      journal.materialize(db(), fixture.schema, limaDate()),
      journal.materialize(db(), fixture.schema, limaDate()),
    ]);
    expect(results.reduce((a, b) => a + b.created, 0)).toBe(1);
    const r = await db().classSessionRecord.findUniqueOrThrow({
      where: {
        date_classId_hourSessionId: {
          date: new Date(limaDate()),
          classId: fixture.classId,
          hourSessionId: hour.id,
        },
      },
    });
    expect(r.teachingStatus).toBe('UNCONFIRMED');
    expect(r.snapshot).toEqual(expect.objectContaining({ className: 'Class' }));
    await expect(
      journal.materialize(db(), fixture.schema, '2020-01-01'),
    ).rejects.toThrow('Solo se materializa');
    await db()
      .$executeRaw`UPDATE class_session_records SET scheduled_start=clock_timestamp()-interval '2 minutes',scheduled_end=clock_timestamp()-interval '1 minute' WHERE id=${r.id}`;
    await Promise.all([
      followup.generate(fixture.schema),
      followup.generate(fixture.schema),
    ]);
    expect(await db().sessionAlert.count({ where: { recordId: r.id } })).toBe(
      1,
    );
    const alert = await db().sessionAlert.findFirstOrThrow({
      where: { recordId: r.id },
    });
    await api(
      'post',
      `/alerts/${alert.id}/acknowledge`,
      'otherSupervisor',
    ).expect(404);
    await api('post', `/alerts/${alert.id}/acknowledge`, 'supervisor').expect(
      201,
    );
    expect(
      (await db().classSessionRecord.findUniqueOrThrow({ where: { id: r.id } }))
        .titularOutcome,
    ).toBe('UNKNOWN');
    await expect(
      db().schedule.create({
        data: {
          classId: fixture.classId,
          hourSessionId: hour.id,
          courseId: 2,
          weekday,
        },
      }),
    ).rejects.toThrow();
  });
  it('programa recuperación dominical sin modificar horario semanal', async () => {
    const r = await fresh();
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + ((7 - day.getUTCDay()) % 7 || 7));
    const date = day.toISOString().slice(0, 10);
    const schedules = await db().schedule.count();
    const recovery = body<{ origin: string; date: string }>(
      await api('post', '/recoveries', 'admin')
        .send({
          originalRecordId: r.id,
          classId: otherClass,
          hourSessionId: 1,
          date,
          reason: 'Recuperación domingo',
        })
        .expect(201),
    );
    expect(recovery.origin).toBe('RECOVERY');
    expect(new Date(recovery.date).getUTCDay()).toBe(0);
    expect(await db().schedule.count()).toBe(schedules);
  });
  it('clasifica llegada única, otro docente, reanudación, datos pendientes y tolerancia histórica', async () => {
    const date = new Date('2026-04-01');
    const start = new Date('2026-04-01T13:00:00Z');
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const hour = await db().hourSession.create({
        data: {
          shiftId: 1,
          period: 20 + i,
          startTime: new Date('1970-01-01T08:00:00Z'),
          endTime: new Date('1970-01-01T08:40:00Z'),
        },
      });
      const s = new Date(+start + i * 45 * 60000 + (i >= 3 ? 30 * 60000 : 0));
      const r = await db().classSessionRecord.create({
        data: {
          date,
          classId: fixture.classId,
          hourSessionId: hour.id,
          shiftId: 1,
          areaId: 1,
          courseId: 1,
          period: i + 1,
          pedagogicalMinutes: 40,
          scheduledStart: s,
          scheduledEnd: new Date(+s + 40 * 60000),
          shiftEnd: new Date(+s + 40 * 60000),
          editDeadline: new Date(+s + 130 * 60000),
          titularTeacherId: teacherIds[0],
          effectiveTeacherId: i >= 2 ? teacherIds[1] : teacherIds[0],
          actualStart: i === 4 ? null : new Date(+s + 8 * 60000),
          actualEnd: i === 4 ? null : new Date(+s + 40 * 60000),
          teachingStatus: i === 4 ? 'UNCONFIRMED' : 'TAUGHT',
          snapshot: {},
          timingPolicy: {
            version: 1,
            latenessToleranceMinutes: 5,
            continuityGapMinutes: 10,
          },
        },
      });
      ids.push(r.id);
    }
    const rows = await db().$queryRaw<
      { timing_kind: string; timing_classification: string }[]
    >`SELECT timing_kind,timing_classification FROM v_class_session_records_report WHERE date=${date}::date ORDER BY period`;
    expect(rows.map((r) => r.timing_kind)).toEqual([
      'ARRIVAL',
      'CONTINUATION',
      'ARRIVAL',
      'RESUMPTION',
      'PENDING',
    ]);
    expect(
      rows.filter(
        (r) =>
          r.timing_kind === 'ARRIVAL' && r.timing_classification === 'LATE',
      ),
    ).toHaveLength(2);
    await db().sessionOperationalConfig.update({
      where: { id: 1 },
      data: { latenessToleranceMinutes: 99 },
    });
    expect(
      (
        await db().$queryRaw<
          { timing_classification: string }[]
        >`SELECT timing_classification FROM v_class_session_records_report WHERE id=${ids[0]}`
      )[0].timing_classification,
    ).toBe('LATE');
    await db().classSessionRecord.update({
      where: { id: ids[0] },
      data: { actualStart: null },
    });
    expect(
      (
        await db().$queryRaw<
          { timing_kind: string }[]
        >`SELECT timing_kind FROM v_class_session_records_report WHERE id=${ids[1]}`
      )[0].timing_kind,
    ).toBe('PENDING');
    await db().classSessionRecord.update({
      where: { id: ids[2] },
      data: { timingPolicy: {} },
    });
    expect(
      (
        await db().$queryRaw<
          { timing_classification: string }[]
        >`SELECT timing_classification FROM v_class_session_records_report WHERE id=${ids[2]}`
      )[0].timing_classification,
    ).toBe('UNCONFIGURED');
  });
  it('reportes sin multiplicación de joins, solicitudes no son dictado y borrado explícito', async () => {
    const r = await fresh();
    await db().classSessionRecord.update({
      where: { id: r.id },
      data: {
        date: new Date('2026-05-01'),
        titularOutcome: 'ABSENT',
        incidents: 'Incidencia',
      },
    });
    await db().sessionCoverage.createMany({
      data: [
        {
          recordId: r.id,
          kind: 'TEACHER',
          teacherId: teacherIds[1],
          mode: 'EMERGENCY',
          status: 'REJECTED',
          personSnapshot: {},
          operationId: randomUUID(),
          requestedBy: {},
          reason: 'Histórico',
        },
        {
          recordId: r.id,
          kind: 'TEACHER',
          teacherId: teacherIds[1],
          mode: 'EMERGENCY',
          status: 'PENDING',
          personSnapshot: {},
          operationId: randomUUID(),
          requestedBy: {},
          reason: 'Pendiente',
        },
      ],
    });
    await db().sessionReview.createMany({
      data: [
        {
          recordId: r.id,
          recordVersion: 1,
          supervisorId: fixture.supervisorId,
          result: 'OBSERVED',
          actor: {},
          files: [],
        },
        {
          recordId: r.id,
          recordVersion: 2,
          supervisorId: fixture.supervisorId,
          result: 'CONFORMING',
          actor: {},
          files: [],
        },
      ],
    });
    const query = '?from=2026-05-01&to=2026-05-01';
    const report = body<{ data: unknown[]; total: number }>(
      await api('get', `/reports/detail${query}`, 'admin').expect(200),
    );
    expect(report.total).toBe(1);
    expect(report.data).toHaveLength(1);
    expect(report.data[0]).toEqual(
      expect.objectContaining({
        authorized_teacher_id: null,
        requested_teacher_id: teacherIds[1],
        scheduled_minutes: expect.any(String) as unknown,
        actual_minutes: null,
        actual_clock_hours: null,
      }),
    );
    const totals = body<Record<string, number>>(
      await api('get', `/reports/summary${query}`, 'admin').expect(200),
    );
    expect(totals.absent_blocks).toBe(1);
    expect(totals.executed_replacement_blocks).toBe(0);
    expect(totals.pending_replacement_blocks).toBe(1);
    expect(totals.incident_records).toBe(1);
    await api('get', '/reports/detail', 'admin').expect(400);
    await api('post', `/${r.id}/cancel`, 'admin')
      .send({ expectedVersion: 1, reason: 'Exclusión reporte' })
      .expect(201);
    expect(
      body<{ total: number }>(
        await api('get', `/reports/detail${query}`, 'admin'),
      ).total,
    ).toBe(0);
    expect(
      body<{ total: number }>(
        await api(
          'get',
          `/reports/detail${query}&includeDeleted=true`,
          'admin',
        ),
      ).total,
    ).toBe(1);
  });
  it('instala con Prisma deploy y applyStructure: columnas/constraints del módulo equivalentes', async () => {
    const schema = `session_migrations_${randomUUID().replace(/-/g, '')}`;
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('schema', schema);
    try {
      execFileSync('./node_modules/.bin/prisma', ['migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: 'pipe',
      });
      const tables = [
        'class_session_records',
        'files',
        'session_coverages',
        'session_audit_events',
        'session_reviews',
        'session_edit_grants',
        'session_alerts',
        'session_operational_config',
      ];
      const columns = async (s: string) =>
        (
          await fixture.pg.query<{
            table_name: string;
            column_name: string;
            data_type: string;
            is_nullable: string;
          }>(
            `SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2) ORDER BY table_name,ordinal_position`,
            [s, tables],
          )
        ).rows;
      expect(await columns(schema)).toEqual(await columns(fixture.schema));
      const constraints = async (s: string) =>
        (
          await fixture.pg.query<{
            relname: string;
            contype: string;
            definition: string;
          }>(
            `SELECT c.relname,k.contype,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2) ORDER BY c.relname,k.contype,definition`,
            [s, tables],
          )
        ).rows.map((r) => ({
          ...r,
          definition: r.definition
            .replaceAll(`"${s}".`, '')
            .replaceAll(`${s}.`, ''),
        }));
      expect(await constraints(schema)).toEqual(
        await constraints(fixture.schema),
      );
    } finally {
      await fixture.pg.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
  it('crea un proceso completo con la utilidad real sin modificar autorización pública', async () => {
    const schema = `session_process_${randomUUID().replace(/-/g, '')}`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await applyStructure(connection, schema, true);
      await initialDataSchema(connection, {
        emailDomain: '@new.test',
        createSchedules: false,
        shifts: [
          {
            name: 'Turno 1',
            startTime: '08:00',
            endTime: '08:40',
            classesToAreas: [{ area: 'Biomédicas', quantityClasses: 1 }],
          },
        ],
      });
      await connection.query('COMMIT');
      const client = fixture.client(schema);
      expect(await client.class.count()).toBe(1);
      expect(await client.monitor.count()).toBe(1);
      expect(
        await client.sessionOperationalConfig.findUnique({ where: { id: 1 } }),
      ).toEqual(
        expect.objectContaining({
          enabled: false,
          latenessToleranceMinutes: null,
        }),
      );
      expect(
        await client.user.findUnique({ where: { id: actor('admin').userId } }),
      ).toBeNull();
      const view = await client.$queryRaw<
        { total: number }[]
      >`SELECT count(*)::int AS total FROM v_class_session_records_report`;
      expect(view[0].total).toBe(0);
      await connection.query('BEGIN');
      await applyStructure(connection, schema);
      await connection.query('COMMIT');
      expect(await client.class.count()).toBe(1);
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
      await pool.end();
      await fixture.pg.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
  it('File reutilizable tiene UUIDv7 nativo y no expone archivos ajenos a partes', async () => {
    const file = await db().file.create({
      data: {
        bucket: 'general',
        objectName: randomUUID(),
        originalName: 'documento.pdf',
        contentType: 'application/pdf',
        size: 20,
        uploadedBy: { purpose: 'other-module' },
      },
    });
    expect(file.id[14]).toBe('7');
    expect(file.recordId).toBeNull();
    const monitor = await db().user.create({
      data: { email: 'uuidv7@test.invalid', role: 'monitor' },
    });
    expect(monitor.id[14]).toBe('7');
    const [{ type }] = await db().$queryRaw<
      { type: string }[]
    >`SELECT pg_typeof(id)::text AS type FROM class_session_records LIMIT 1`;
    expect(type).toBe('integer');
  });
  it('configura políticas versionadas y tareas respetan mantenimiento/runtime sin usar default', async () => {
    const current = await db().sessionOperationalConfig.findUniqueOrThrow({
      where: { id: 1 },
    });
    await api('patch', '/configuration', 'admin')
      .send({
        expectedVersion: current.version,
        enabled: true,
        startsOn: null,
        endsOn: null,
        reason: 'Faltan fechas',
      })
      .expect(400);
    await api('patch', '/configuration', 'admin')
      .send({
        expectedVersion: current.version,
        enabled: false,
        latenessToleranceMinutes: null,
        reason: 'Pendiente institucional',
      })
      .expect(200);
    await api('patch', '/configuration', 'admin')
      .send({
        expectedVersion: current.version,
        enabled: false,
        reason: 'Versión anterior',
      })
      .expect(409);
    const runtime = { getCurrent: jest.fn().mockResolvedValue(null) };
    const schemaManager = {
      getAllWithCache: jest
        .fn()
        .mockResolvedValue([
          { name: fixture.schema },
          { name: fixture.coreSchema },
          { name: 'public' },
        ]),
    };
    const getClient = jest.spyOn(records.prisma, 'getClientForSchema');
    const task = new SessionFollowupService(
      records,
      journal,
      runtime as never,
      schemaManager as never,
      new ConfigService({ CORE_SCHEMA: fixture.coreSchema }),
    );
    await task.tick();
    expect(getClient).not.toHaveBeenCalled();
    runtime.getCurrent.mockResolvedValue({ maintenance: { enabled: true } });
    await task.tick();
    expect(getClient).not.toHaveBeenCalled();
    runtime.getCurrent.mockResolvedValue({ maintenance: { enabled: false } });
    await task.tick();
    expect(getClient.mock.calls.map((c) => c[0])).toEqual([
      fixture.schema,
      fixture.schema,
    ]);
    expect(schemaManager.getAllWithCache).toHaveBeenCalledTimes(1);
  });
  it('un proceso inválido no bloquea materialización y alertas de otros procesos', async () => {
    const bad = fixture.client(fixture.otherSchema);
    const date = limaDate();
    const future = new Date(Date.now() + 120000);
    const time = new Date(
      `1970-01-01T${new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(future)}Z`,
    );
    const weekday = [
      'Domingo',
      'Lunes',
      'Martes',
      'Miercoles',
      'Jueves',
      'Viernes',
      'Sabado',
    ][new Date(date).getUTCDay()] as never;
    await bad.hourSession.update({
      where: { id: 1 },
      data: { startTime: time, endTime: new Date(+time + 60000) },
    });
    await bad.schedule.create({
      data: {
        classId: fixture.classId,
        hourSessionId: 1,
        courseId: 1,
        weekday,
      },
    });
    const hour = await db().hourSession.create({
      data: {
        shiftId: 1,
        period: 15,
        startTime: time,
        endTime: new Date(+time + 60000),
      },
    });
    await db().schedule.create({
      data: {
        classId: fixture.classId,
        hourSessionId: hour.id,
        courseId: 1,
        weekday,
      },
    });
    for (const client of [bad, db()])
      await client.sessionOperationalConfig.update({
        where: { id: 1 },
        data: {
          enabled: true,
          startsOn: new Date(date),
          endsOn: new Date(date),
        },
      });
    const runtime = {
      getCurrent: () => Promise.resolve({ maintenance: { enabled: false } }),
    };
    const schemas = {
      getAllWithCache: () =>
        Promise.resolve([
          { name: fixture.otherSchema },
          { name: fixture.schema },
        ]),
    };
    const task = new SessionFollowupService(
      records,
      journal,
      runtime as never,
      schemas as never,
      new ConfigService({ CORE_SCHEMA: fixture.coreSchema }),
    );
    await expect(task.tick()).resolves.toBeUndefined();
    expect(
      await db().classSessionRecord.count({
        where: { date: new Date(date), hourSessionId: hour.id },
      }),
    ).toBe(1);
    expect(
      await bad.classSessionRecord.count({
        where: { date: new Date(date), hourSessionId: 1 },
      }),
    ).toBe(0);
  });
  it('anulación/restauración y antecedentes incompletos recalculan correctamente los tramos', async () => {
    const date = new Date('2026-04-01');
    const [first, second, third] = await db().classSessionRecord.findMany({
      where: { date },
      orderBy: { period: 'asc' },
    });
    const classification = async (id: number) =>
      (
        await db().$queryRaw<
          { timing_kind: string }[]
        >`SELECT timing_kind FROM v_class_session_records_report WHERE id=${id}`
      )[0].timing_kind;
    await db().classSessionRecord.update({
      where: { id: first.id },
      data: {
        actualStart: new Date(+first.scheduledStart + 60000),
        actualEnd: null,
      },
    });
    expect(await classification(second.id)).toBe('PENDING');
    await db().classSessionRecord.update({
      where: { id: second.id },
      data: { actualStart: null },
    });
    expect(await classification(third.id)).toBe('ARRIVAL');
    await db().classSessionRecord.update({
      where: { id: first.id },
      data: {
        actualStart: first.scheduledStart,
        actualEnd: first.scheduledEnd,
      },
    });
    await db().classSessionRecord.update({
      where: { id: second.id },
      data: {
        actualStart: new Date(+second.scheduledStart + 15 * 60000),
        actualEnd: second.scheduledEnd,
      },
    });
    expect(await classification(second.id)).toBe('CONTINUATION');
    await api('post', `/${first.id}/cancel`, 'admin')
      .send({ expectedVersion: first.version, reason: 'Anular antecedente' })
      .expect(201);
    expect(await classification(second.id)).toBe('ARRIVAL');
    const summary = body<{ late_arrivals: number }>(
      await api(
        'get',
        '/reports/summary?from=2026-04-01&to=2026-04-01',
        'admin',
      ),
    );
    expect(summary.late_arrivals).toBe(1);
    await api('post', `/${first.id}/restore`, 'admin')
      .send({
        expectedVersion: first.version + 1,
        reason: 'Restaurar antecedente',
      })
      .expect(201);
    expect(await classification(second.id)).toBe('CONTINUATION');
  });
  it('rechazo de cobertura no libera ejecución efectiva solapada, docente y monitor', async () => {
    for (const kind of ['TEACHER', 'MONITOR']) {
      const r = await fresh(),
        other = await fresh();
      await db().classSessionRecord.update({
        where: { id: other.id },
        data: {
          date: r.date,
          classId: otherClass,
          scheduledStart: r.scheduledStart,
          scheduledEnd: r.scheduledEnd,
          shiftEnd: r.shiftEnd,
          editDeadline: r.editDeadline,
        },
      });
      const personId = kind === 'TEACHER' ? teacherIds[1] : otherMonitorId;
      const response = body<{ data: { id: number }[] }>(
        await api('post', '/replacements')
          .send({
            targets: [{ recordId: r.id, expectedVersion: 1 }],
            kind,
            personId,
            mode: 'EMERGENCY',
            reason: 'Ocurrido en aula original',
          })
          .expect(201),
      );
      await patch(
        { ...r, version: 2 },
        {
          [kind === 'TEACHER' ? 'effectiveTeacherId' : 'effectiveMonitorId']:
            personId,
          actualStart: r.scheduledStart.toISOString(),
          actualEnd: r.scheduledEnd.toISOString(),
          teachingStatus: 'TAUGHT',
        },
      ).expect(200);
      await api('post', `/replacements/${response.data[0].id}/resolve`, 'admin')
        .send({
          expectedVersion: 3,
          status: 'REJECTED',
          reason: 'No autorizado pero ocurrido',
        })
        .expect(201);
      await api('post', '/replacements', 'admin')
        .send({
          targets: [{ recordId: other.id, expectedVersion: 1 }],
          kind,
          personId,
          mode: 'PLANNED',
          reason: 'Intento de solapamiento',
        })
        .expect(409);
    }
  });
});
