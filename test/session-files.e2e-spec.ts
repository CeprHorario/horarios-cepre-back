import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Storage } from '@google-cloud/storage';
import { RequestContext } from '../src/database/schema-manager/request-context';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { SchemaManagerInterceptor } from '../src/database/schema-manager/schema-manager.interceptor';
import { RuntimeConfigService } from '../src/modules/runtime-config/runtime-config.service';
import { AuthGlobalGuard } from '../src/modules/auth/guards/auth-global.guard';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { TokenRevocationService } from '../src/modules/auth/token-revocation.service';
import { PermissionsService } from '../src/modules/permissions/permissions.service';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { AuthorizationGuard } from '../src/modules/auth/guards/authorization.guard';
import { ClassSessionRecordsService } from '../src/modules/class-session-records/class-session-records.service';
import { SessionPrincipal } from '../src/modules/class-session-records/session.types';
import { SessionFilesController } from '../src/modules/session-files/session-files.controller';
import { SessionFilesService } from '../src/modules/session-files/session-files.service';
import { SessionObjectStorage } from '../src/modules/session-files/session-object-storage.service';
import {
  pngFixture,
  uploadFixture,
  SessionFilesFixture,
} from './helpers/session-files-fixtures';

// Real JWT/guards/context + PostgreSQL 18/PrismaPg/GCS. Only runtime/registry and revocation storage are fixtures.
const suite =
  process.env.TEST_DATABASE_URL && process.env.STORAGE_EMULATOR_HOST
    ? describe
    : describe.skip;
suite('Session files (PostgreSQL + fake GCS)', () => {
  jest.setTimeout(120_000);
  const fixture = new SessionFilesFixture();
  const als = fixture.context;
  const routing = { adminSchema: fixture.schema, userSchema: fixture.schema };
  const jwt = new JwtService({ secret: 'session-files-test-only' });
  const bucket = `session-files-${randomUUID()}`;
  let app: INestApplication;
  let objects: SessionObjectStorage;
  let records: ClassSessionRecordsService;
  let service: SessionFilesService;
  let currentRecord: Awaited<ReturnType<SessionFilesFixture['record']>>;
  let storage: Storage;
  const body = (response: request.Response) =>
    response.body as Record<string, string>;
  const server = () => app.getHttpServer() as Server;

  const token = (
    name: string,
    overrides: Partial<SessionPrincipal & { schema: string }> = {},
  ) =>
    jwt.sign(
      {
        id: fixture.principals[name].userId,
        email: fixture.principals[name].email,
        role: fixture.principals[name].role,
        schema: name === 'admin' ? 'core_schema' : fixture.schema,
        ...overrides,
      },
      { expiresIn: '1h', issuer: 'cepr', audience: 'cepr-api' },
    );
  const upload = (name = 'monitor', authToken = token(name)) =>
    request(server())
      .post(`/class-session-files/records/${currentRecord.id}`)
      .auth(authToken, { type: 'bearer' })
      .attach('file', pngFixture(), {
        filename: 'captura.png',
        contentType: 'image/png',
      });
  const content = (fileId: string, name = 'monitor', authToken = token(name)) =>
    request(server())
      .get(`/class-session-files/${fileId}/content`)
      .auth(authToken, { type: 'bearer' });
  const associate = (
    fileId: string,
    expectedVersion: number,
    slot = 'initial',
    name = 'monitor',
  ) =>
    request(server())
      .post(`/class-session-files/records/${currentRecord.id}/captures/${slot}`)
      .auth(token(name), { type: 'bearer' })
      .send({ fileId, expectedVersion });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.STORAGE_EMULATOR_HOST)
      throw new Error(
        'Run with the project Docker Compose PostgreSQL and GCS emulator',
      );
    await fixture.initialize();
    const config = new ConfigService({
      CORE_SCHEMA: fixture.coreSchema,
      GOOGLE_CLOUD_PROJECT: 'cepr-local',
      GCS_BUCKET: bucket,
      STORAGE_EMULATOR_HOST: process.env.STORAGE_EMULATOR_HOST,
      JWT_SECRET: 'session-files-test-only',
    });
    storage = new Storage({
      projectId: 'cepr-local',
      apiEndpoint: process.env.STORAGE_EMULATOR_HOST,
      useAuthWithCustomEndpoint: false,
    });
    storage.baseUrl = `${process.env.STORAGE_EMULATOR_HOST}/storage/v1`;
    await storage.createBucket(bucket);
    const module = await Test.createTestingModule({
      controllers: [SessionFilesController],
      providers: [
        SessionFilesService,
        SessionObjectStorage,
        ClassSessionRecordsService,
        AuthGlobalGuard,
        JwtAuthGuard,
        JwtStrategy,
        AuthorizationGuard,
        SchemaManagerInterceptor,
        { provide: PrismaService, useValue: fixture.apiPrisma },
        { provide: RequestContext, useValue: als },
        {
          provide: SchemaManagerService,
          useValue: {
            assertAvailable: () => Promise.resolve(),
            getCurrent: () => Promise.resolve({ name: fixture.schema }),
          },
        },
        {
          provide: RuntimeConfigService,
          useValue: {
            getCurrent: () =>
              Promise.resolve({
                schemaRouting: routing,
                maintenance: { enabled: false },
              }),
          },
        },
        {
          provide: TokenRevocationService,
          useValue: { assertActive: () => Promise.resolve() },
        },
        {
          provide: PermissionsService,
          useValue: { checkPermission: () => Promise.resolve(true) },
        },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards(module.get(AuthGlobalGuard));
    app.useGlobalInterceptors(module.get(SchemaManagerInterceptor));
    app.use((_req: Request, _res: Response, next: NextFunction) =>
      als.run({}, next),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    records = module.get(ClassSessionRecordsService);
    objects = module.get(SessionObjectStorage);
    service = module.get(SessionFilesService);
  });

  beforeEach(async () => {
    currentRecord = await fixture.record();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    routing.adminSchema = fixture.schema;
    routing.userSchema = fixture.schema;
  });
  afterAll(async () => {
    await app?.close();
    // Retain emulator objects, just as the API does. The test uses a unique bucket each run.
    await fixture.close();
  });

  it('uploads, downloads, associates, replaces and retains previous evidence without upload/read version changes', async () => {
    const first = body(await upload().expect(201));
    expect(first.status).toBe('AVAILABLE');
    expect(first.id[14]).toBe('7');
    expect(typeof first.generation).toBe('string');
    expect(
      (
        await fixture.client().classSessionRecord.findUniqueOrThrow({
          where: { id: currentRecord.id },
        })
      ).initialFileId,
    ).toBeNull();
    const downloaded = await content(first.id).expect(200);
    expect(downloaded.body).toEqual(pngFixture());
    expect(downloaded.headers['cache-control']).toBe('private, no-store');
    expect(downloaded.headers['x-content-type-options']).toBe('nosniff');
    expect(
      (
        await fixture.client().classSessionRecord.findUniqueOrThrow({
          where: { id: currentRecord.id },
        })
      ).version,
    ).toBe(1);
    const associated = body(await associate(first.id, 1).expect(201));
    expect(associated.initialFileId).toBe(first.id);
    expect(associated.initialAssociatedAt).toBeTruthy();
    const second = body(await upload().expect(201));
    expect(second.objectName).not.toBe(first.objectName);
    await associate(second.id, 2).expect(201);
    await associate(second.id, 3, 'final').expect(201);
    await content(first.id, 'supervisor').expect(200);
    const previous = await fixture
      .client()
      .file.findUniqueOrThrow({ where: { id: first.id } });
    expect(previous.status).toBe('AVAILABLE');
    const events = await fixture.client().sessionAuditEvent.findMany({
      where: { recordId: currentRecord.id, action: 'CAPTURE_ASSOCIATED' },
      orderBy: { id: 'asc' },
    });
    expect(events[1].before).toEqual(
      expect.objectContaining({ initialFileId: first.id }),
    );
    expect(events[1].after).toEqual(
      expect.objectContaining({ initialFileId: second.id }),
    );
  });

  it('rechaza cambio de cuenta dentro del proceso antes de consultar, subir o asociar archivos', async () => {
    const uploaded = body(await upload().expect(201));
    const before = await fixture
      .client()
      .sessionAuditEvent.count({ where: { recordId: currentRecord.id } });
    const oldAccount = fixture.principals.monitor.userId;
    const read = jest.spyOn(service, 'content');
    const write = jest.spyOn(service, 'upload');
    const attach = jest.spyOn(service, 'associate');
    const blocked = await content(uploaded.id, 'admin')
      .set('X-Class-Session-Context', fixture.schema)
      .set('X-Class-Session-Account', oldAccount)
      .expect(409);
    expect(body(blocked).code).toBe('CLASS_SESSION_CONTEXT_CHANGED');
    await upload('admin')
      .set('X-Class-Session-Account', oldAccount)
      .expect(409);
    await associate(uploaded.id, 1, 'initial', 'admin')
      .set('X-Class-Session-Account', oldAccount)
      .expect(409);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
    expect(
      await fixture
        .client()
        .file.count({ where: { recordId: currentRecord.id } }),
    ).toBe(1);
    expect(
      await fixture
        .client()
        .sessionAuditEvent.count({ where: { recordId: currentRecord.id } }),
    ).toBe(before);
    expect(
      (
        await fixture
          .client()
          .classSessionRecord.findUniqueOrThrow({
            where: { id: currentRecord.id },
          })
      ).version,
    ).toBe(1);
    await content(uploaded.id, 'admin')
      .set('X-Class-Session-Account', fixture.principals.admin.userId)
      .expect(200);
    await associate(uploaded.id, 1, 'initial', 'admin')
      .set('X-Class-Session-Account', fixture.principals.admin.userId)
      .expect(201);
  });
  it('rejects anonymous, other monitor, other supervisor, teacher and coordinator despite global permissions', async () => {
    const uploaded = body(await upload().expect(201));
    await request(server())
      .get(`/class-session-files/${uploaded.id}/content`)
      .expect(401);
    for (const name of ['otherMonitor', 'otherSupervisor'])
      await content(uploaded.id, name).expect(404);
    for (const name of ['teacher', 'coordinator']) {
      await content(uploaded.id, name).expect(401);
      await upload(name).expect(401);
    }
    await upload('otherMonitor').expect(404);
    await upload('supervisor').expect(401);
    await associate(uploaded.id, 1, 'initial', 'supervisor').expect(401);
  });
  it('File sin parte sirve a otros módulos pero no puede leerse ni asociarse como evidencia', async () => {
    const file = await fixture.client().file.create({
      data: {
        bucket,
        objectName: `other-module/${randomUUID()}`,
        originalName: 'otro.png',
        contentType: 'image/png',
        size: 1,
        uploadedBy: {},
        generation: '1',
        checksum: 'not-evidence',
        status: 'AVAILABLE',
      },
    });
    expect(file.id[14]).toBe('7');
    for (const name of ['monitor', 'supervisor', 'admin'])
      await content(file.id, name).expect(404);
    await associate(file.id, 1).expect(404);
  });

  it('rejects JWT/process mismatch and stale admin context before files with matching IDs are read or changed', async () => {
    const uploaded = body(await upload().expect(201));
    const other = fixture.client(fixture.otherSchema);
    // Rows with coincident IDs exist in the other process, but the authenticated origin is not the runtime process.
    const fileId = uploaded.id;
    expect(
      await other.user.findUnique({
        where: { id: fixture.principals.monitor.userId },
      }),
    ).not.toBeNull();
    const source = await fixture.client().classSessionRecord.findUniqueOrThrow({
      where: { id: currentRecord.id },
    });
    await other.$executeRaw`INSERT INTO areas(id,name) VALUES (1,'Area')`;
    await other.$executeRaw`INSERT INTO courses(id,name) VALUES (1,'Course')`;
    await other.$executeRaw`INSERT INTO sedes(id,name) VALUES (1,'Sede')`;
    await other.$executeRaw`INSERT INTO shifts(id,name) VALUES (1,'Shift')`;
    await other.$executeRaw`INSERT INTO hour_sessions(id,shift_id,period,start_time,end_time) VALUES (1,1,1,'08:00','08:40')`;
    await other.$executeRaw`INSERT INTO classes(id,name,id_sede,area_id,shift_id) VALUES (${fixture.classId}::uuid,'Class',1,1,1)`;
    await other.classSessionRecord.create({
      data: {
        ...source,
        supervisorId: null,
        snapshot: {},
        effectiveSnapshot: {},
        timingPolicy: {},
        initialAssociatedBy: undefined,
        finalAssociatedBy: undefined,
        deletedBy: undefined,
      },
    });
    const stored = await fixture
      .client()
      .file.findUniqueOrThrow({ where: { id: fileId } });
    await other.file.create({
      data: { ...stored, uploadedBy: {}, deletedBy: undefined },
    });
    await content(
      fileId,
      'monitor',
      token('monitor', { schema: fixture.otherSchema }),
    ).expect(401);
    await upload(
      'monitor',
      token('monitor', { schema: fixture.otherSchema }),
    ).expect(401);
    routing.adminSchema = fixture.otherSchema;
    const read = jest.spyOn(service, 'content');
    const write = jest.spyOn(service, 'upload');
    const attach = jest.spyOn(service, 'associate');
    await content(fileId, 'admin')
      .set('X-Class-Session-Context', fixture.schema)
      .expect(409);
    await upload('admin')
      .set('X-Class-Session-Context', fixture.schema)
      .expect(409);
    await associate(fileId, 1, 'initial', 'admin')
      .set('X-Class-Session-Context', fixture.schema)
      .expect(409);
    await request(server())
      .post(
        `/class-session-files/records/${currentRecord.id}/corrections/upload`,
      )
      .auth(token('admin'), { type: 'bearer' })
      .set('X-Class-Session-Context', fixture.schema)
      .field('reason', 'No debe escribir en otro proceso')
      .attach('file', pngFixture(), {
        filename: 'obsoleta.png',
        contentType: 'image/png',
      })
      .expect(409);
    await request(server())
      .post(
        `/class-session-files/records/${currentRecord.id}/corrections/captures/final`,
      )
      .auth(token('admin'), { type: 'bearer' })
      .set('X-Class-Session-Context', fixture.schema)
      .send({
        expectedVersion: 1,
        fileId,
        reason: 'No debe asociar en otro proceso',
      })
      .expect(409);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
    expect(await other.file.count()).toBe(1);
    expect(await other.sessionAuditEvent.count()).toBe(0);
    expect(
      (
        await other.classSessionRecord.findUniqueOrThrow({
          where: { id: currentRecord.id },
        })
      ).version,
    ).toBe(1);
    await content(fileId, 'admin')
      .set('X-Class-Session-Context', fixture.otherSchema)
      .expect(200);
    await content(fileId, 'admin').expect(200);
    routing.adminSchema = fixture.schema;
    await content(fileId, 'admin')
      .set('X-Class-Session-Context', fixture.otherSchema)
      .expect(409);
  });
  it('permite corregir capturas cerradas solo por ruta administrativa motivada y conserva evidencia/plazo', async () => {
    const first = body(await upload().expect(201));
    await associate(first.id, 1).expect(201);
    await fixture.closeRecord(currentRecord.id);
    const closed = await fixture.client().classSessionRecord.findUniqueOrThrow({
      where: { id: currentRecord.id },
    });
    await associate(first.id, 2, 'final', 'admin').expect(403);
    const correctionUpload = (name = 'admin', reason?: string) => {
      const req = request(server())
        .post(
          `/class-session-files/records/${currentRecord.id}/corrections/upload`,
        )
        .auth(token(name), { type: 'bearer' });
      if (reason !== undefined) req.field('reason', reason);
      return req.attach('file', pngFixture(), {
        filename: 'correccion.png',
        contentType: 'image/png',
      });
    };
    await correctionUpload('admin').expect(400);
    await correctionUpload('monitor', 'No autorizado').expect(401);
    const second = body(
      await correctionUpload(
        'admin',
        'Incorporar evidencia excepcional',
      ).expect(201),
    );
    const path = `/class-session-files/records/${currentRecord.id}/corrections/captures/initial`;
    await request(server())
      .post(path)
      .auth(token('admin'), { type: 'bearer' })
      .send({ expectedVersion: 2, fileId: second.id })
      .expect(400);
    await request(server())
      .post(path)
      .auth(token('admin'), { type: 'bearer' })
      .send({
        expectedVersion: 2,
        fileId: second.id,
        reason: 'Sustituir captura incorrecta',
      })
      .expect(201);
    await associate(second.id, 3, 'final').expect(403);
    const after = await fixture.client().classSessionRecord.findUniqueOrThrow({
      where: { id: currentRecord.id },
    });
    expect(after.editDeadline).toEqual(closed.editDeadline);
    expect(after.initialFileId).toBe(second.id);
    await content(first.id, 'supervisor').expect(200);
    expect(
      await fixture.client().sessionAuditEvent.findFirst({
        where: {
          recordId: currentRecord.id,
          action: 'ADMIN_CAPTURE_ASSOCIATED',
          reason: 'Sustituir captura incorrecta',
        },
      }),
    ).not.toBeNull();
    expect(
      await fixture.client().sessionAuditEvent.findFirst({
        where: {
          recordId: currentRecord.id,
          action: 'ADMIN_FILE_UPLOAD_AVAILABLE',
          reason: 'Incorporar evidencia excepcional',
        },
      }),
    ).not.toBeNull();
  });

  it('rejects associations with another record, wrong slot/version and another uploader', async () => {
    const uploaded = body(await upload().expect(201));
    await associate(uploaded.id, 99).expect(409);
    await associate(uploaded.id, 1, 'unexpected').expect(400);
    const adminUploaded = body(await upload('admin').expect(201));
    await associate(adminUploaded.id, 1).expect(403);
    await associate(adminUploaded.id, 1, 'initial', 'admin').expect(201);
    currentRecord = await fixture.record();
    await associate(uploaded.id, 1).expect(404);
  });

  it('uses the original deadline for monitor and admin, including already-uploaded captures', async () => {
    const uploaded = body(await upload().expect(201));
    await fixture.closeRecord(currentRecord.id);
    await associate(uploaded.id, 1).expect(403);
    await associate(uploaded.id, 1, 'initial', 'admin').expect(403);
    await upload().expect(403);
    await upload('admin').expect(403);
    const unchanged = await fixture
      .client()
      .classSessionRecord.findUniqueOrThrow({
        where: { id: currentRecord.id },
      });
    expect(unchanged.initialFileId).toBeNull();
    expect(unchanged.version).toBe(1);
  });

  it('retains the GCS object but records FAILED if the deadline passes while uploading', async () => {
    const original = objects.upload.bind(
      objects,
    ) as SessionObjectStorage['upload'];
    jest.spyOn(objects, 'upload').mockImplementation(async (...args) => {
      const generation = await original(...args);
      await fixture.closeRecord(currentRecord.id);
      return generation;
    });
    await upload().expect(403);
    const failed = await fixture
      .client()
      .file.findFirstOrThrow({ where: { recordId: currentRecord.id } });
    expect(failed.status).toBe('FAILED');
    expect(
      (await storage.bucket(bucket).file(failed.objectName).exists())[0],
    ).toBe(true);
    await content(failed.id).expect(404);
  });

  it('allows only admin to download files from logically cancelled records', async () => {
    const uploaded = body(await upload().expect(201));
    await fixture.client().classSessionRecord.update({
      where: { id: currentRecord.id },
      data: { deletedAt: new Date(), deletionReason: 'test cancellation' },
    });
    await content(uploaded.id, 'monitor').expect(404);
    await content(uploaded.id, 'supervisor').expect(404);
    await content(uploaded.id, 'admin').expect(200);
  });

  it('audits the access request even if storage retrieval fails, without increasing version', async () => {
    const uploaded = body(await upload().expect(201));
    jest.spyOn(objects, 'download').mockRejectedValueOnce(new Error('offline'));
    await content(uploaded.id).expect(503);
    expect(
      await fixture.client().sessionAuditEvent.count({
        where: {
          recordId: currentRecord.id,
          action: 'FILE_ACCESS_REQUESTED',
        },
      }),
    ).toBe(1);
    expect(
      (
        await fixture.client().classSessionRecord.findUniqueOrThrow({
          where: { id: currentRecord.id },
        })
      ).version,
    ).toBe(1);
  });

  it('enforces storage create-only preconditions and preserves generations without numeric coercion', async () => {
    const bytes = pngFixture(),
      objectName = `precondition/${randomUUID()}.png`;
    const generation = await objects.upload(
      bucket,
      objectName,
      bytes,
      'test-checksum',
    );
    expect(generation).toMatch(/^\d+$/);
    await expect(
      objects.upload(bucket, objectName, bytes, 'test-checksum'),
    ).rejects.toMatchObject({ code: 412 });
    expect(await objects.download(bucket, objectName, generation)).toEqual(
      bytes,
    );
  });

  it('rejects invalid multipart content and the 10 MiB limit before creating metadata', async () => {
    const path = `/class-session-files/records/${currentRecord.id}`;
    await request(server())
      .post(path)
      .auth(token('monitor'), { type: 'bearer' })
      .expect(400);
    for (const [bytes, contentType, status] of [
      [Buffer.from('<svg/>'), 'image/png', 400],
      [pngFixture(), 'image/jpeg', 400],
      [Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png', 413],
    ] as const) {
      await request(server())
        .post(path)
        .auth(token('monitor'), { type: 'bearer' })
        .attach('file', bytes, { filename: 'captura.png', contentType })
        .expect(status);
    }
    expect(
      await fixture
        .client()
        .file.count({ where: { recordId: currentRecord.id } }),
    ).toBe(0);
  });

  it('rolls back availability and retains the uploaded object if final database auditing fails', async () => {
    const original = records.audit.bind(
      records,
    ) as ClassSessionRecordsService['audit'];
    jest.spyOn(records, 'audit').mockImplementation((...args) => {
      if (args[3] === 'FILE_UPLOAD_AVAILABLE')
        throw new Error('Simulated database failure');
      return original(...args);
    });
    // Call the real service directly to avoid expected-exception HTTP logging.
    await als.run({ schema: fixture.schema, routing }, async () => {
      await expect(
        service.upload(
          fixture.principals.monitor,
          currentRecord.id,
          uploadFixture(),
        ),
      ).rejects.toThrow('Simulated database failure');
    });
    const failed = await fixture
      .client()
      .file.findFirstOrThrow({ where: { recordId: currentRecord.id } });
    expect(failed.status).toBe('FAILED');
    expect(
      (await storage.bucket(bucket).file(failed.objectName).exists())[0],
    ).toBe(true);
    const availabilityEvents = await fixture.client().sessionAuditEvent.count({
      where: { recordId: currentRecord.id, action: 'FILE_UPLOAD_AVAILABLE' },
    });
    expect(availabilityEvents).toBe(0);
    await content(failed.id).expect(404);
  });

  it('rechecks the PostgreSQL clock after association validations before writing', async () => {
    const uploaded = body(await upload().expect(201));
    await fixture.client()
      .$executeRaw`UPDATE class_session_records SET scheduled_start=CURRENT_TIMESTAMP-interval '3 hours', scheduled_end=CURRENT_TIMESTAMP-interval '2 hours', shift_end=CURRENT_TIMESTAMP-interval '90 minutes'+interval '800 milliseconds', edit_deadline=CURRENT_TIMESTAMP+interval '800 milliseconds' WHERE id=${currentRecord.id}`;
    const original = records.now.bind(
      records,
    ) as ClassSessionRecordsService['now'];
    let checks = 0;
    jest.spyOn(records, 'now').mockImplementation(async (tx) => {
      checks++;
      if (checks === 2) {
        // Advance the real PostgreSQL clock past the immutable deadline during validation.
        await tx.$queryRaw`SELECT pg_sleep(1.1)`;
      }
      return original(tx);
    });
    await als.run({ schema: fixture.schema, routing }, async () => {
      await expect(
        service.associate(
          fixture.principals.monitor,
          currentRecord.id,
          'initial',
          { fileId: uploaded.id, expectedVersion: 1 },
        ),
      ).rejects.toThrow();
    });
    expect(
      (
        await fixture.client().classSessionRecord.findUniqueOrThrow({
          where: { id: currentRecord.id },
        })
      ).initialFileId,
    ).toBeNull();
  });
});
