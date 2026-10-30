import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Storage } from '@google-cloud/storage';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { PrismaExceptionInterceptor } from '../../src/database/prisma/interceptors/exception.interceptor';
import { RequestContext } from '../../src/database/schema-manager/request-context';
import { SchemaManagerService } from '../../src/database/schema-manager/schema-manger.service';
import { SchemaManagerInterceptor } from '../../src/database/schema-manager/schema-manager.interceptor';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AuthGlobalGuard } from '../../src/modules/auth/guards/auth-global.guard';
import { AuthorizationGuard } from '../../src/modules/auth/guards/authorization.guard';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { OAuthStateStore } from '../../src/modules/auth/oauth-state.store';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { SyncAuthorizationService } from '../../src/modules/auth/sync-authorization.service';
import { TokenRevocationService } from '../../src/modules/auth/token-revocation.service';
import { setSessionCookie } from '../../src/modules/auth/session-cookie';
import { PermissionsService } from '../../src/modules/permissions/permissions.service';
import { ClassController } from '../../src/modules/classes/class.controller';
import { ClassService } from '../../src/modules/classes/class.service';
import { HourSessionController } from '../../src/modules/hour-session/hour-session.controller';
import { HourSessionService } from '../../src/modules/hour-session/hour-session.service';
import { ScheduleService } from '../../src/modules/schedules/schedules.service';
import { RuntimeConfigController } from '../../src/modules/runtime-config/runtime-config.controller';
import { RuntimeConfigService } from '../../src/modules/runtime-config/runtime-config.service';
import type { RuntimeConfig } from '../../src/modules/runtime-config/interfaces/runtime-config.interface';
import { ClassSessionRecordsController } from '../../src/modules/class-session-records/class-session-records.controller';
import { ClassSessionRecordsService } from '../../src/modules/class-session-records/class-session-records.service';
import {
  SessionJournalService,
  limaDate,
} from '../../src/modules/class-session-records/session-journal.service';
import { SessionFollowupService } from '../../src/modules/class-session-records/session-followup.service';
import { SessionReportsService } from '../../src/modules/class-session-records/session-reports.service';
import { SessionFilesController } from '../../src/modules/session-files/session-files.controller';
import { SessionFilesService } from '../../src/modules/session-files/session-files.service';
import { SessionObjectStorage } from '../../src/modules/session-files/session-object-storage.service';
import { SessionFilesFixture, uploadFixture } from './session-files-fixtures';

const frontend =
  process.env.RECORDS_BROWSER_FRONTEND_ORIGIN ?? 'http://127.0.0.1:5174';
const frontendUrl = new URL(frontend);
if (
  frontendUrl.protocol !== 'http:' ||
  frontendUrl.hostname !== '127.0.0.1' ||
  frontendUrl.origin !== frontend
)
  throw new Error('El frontend del harness debe ser un origen HTTP de loopback');
const scenarioNames = [
  'editable',
  'evidence',
  'closed',
  'pendingReplacement',
  'authorizedReplacement',
  'future',
] as const;

export async function createRecordsBrowserHarness() {
  const database = new URL(process.env.TEST_DATABASE_URL ?? 'http://invalid');
  if (
    process.env.NODE_ENV !== 'test' ||
    !['serve', 'smoke'].includes(process.env.RECORDS_BROWSER_HARNESS ?? '') ||
    process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ||
    database.hostname !== 'db' ||
    database.port !== '5432' ||
    database.pathname !== '/cepr_records_test' ||
    database.username !== 'cepr' ||
    process.env.STORAGE_EMULATOR_HOST !== 'http://gcs:4443'
  )
    throw new Error(
      'Harness exclusivo de compose.records.yaml, NODE_ENV=test y opt-in explícito',
    );

  const fixture = new SessionFilesFixture();
  let closeApp: (() => Promise<void>) | undefined;
  try {
    await fixture.initialize();
    const secret = randomBytes(48).toString('base64url');
    const jwt = new JwtService({ secret });
    const bucket = `records-browser-${randomUUID()}`;
    const ids = {
      monitor: randomUUID(),
      otherMonitor: randomUUID(),
      teacher: randomUUID(),
      replacementTeacher: randomUUID(),
    };
    const processes = {
      a: {
        process: fixture.schema,
        records: {} as Record<(typeof scenarioNames)[number], number>,
      },
      b: {
        process: fixture.otherSchema,
        records: {} as Record<(typeof scenarioNames)[number], number>,
      },
    };
    const runtime: RuntimeConfig = {
      version: 1,
      schemaRouting: {
        adminSchema: fixture.schema,
        userSchema: fixture.schema,
      },
      maintenance: {
        enabled: false,
        message: 'Mantenimiento ficticio para pruebas',
        endsAt: null,
      },
      updatedAt: null,
      updatedBy: {
        id: fixture.principals.admin.userId,
        email: fixture.principals.admin.email,
      },
      changeReason: 'Harness local; datos enteramente ficticios',
    };
    const config = new ConfigService({
      NODE_ENV: 'test',
      REDIRECT_FRONT: frontend,
      JWT_SECRET: secret,
      JWT_EXPIRES_IN: 8 * 3600,
      CORE_SCHEMA: fixture.coreSchema,
      GOOGLE_CLOUD_PROJECT: 'cepr-local',
      GCS_BUCKET: bucket,
      STORAGE_EMULATOR_HOST: process.env.STORAGE_EMULATOR_HOST,
      CLASS_RECORDS_TASK_ENABLED: 'false',
    });
    const revoked = new Map<string, number>();
    const revocations = {
      assertActive: (token: string) => {
        if (
          (revoked.get(createHash('sha256').update(token).digest('hex')) ?? 0) >
          Date.now()
        )
          throw new UnauthorizedException();
        return Promise.resolve();
      },
      revoke: (token: string, expiresAt: number) => {
        revoked.set(
          createHash('sha256').update(token).digest('hex'),
          expiresAt * 1000,
        );
        return Promise.resolve();
      },
    };
    const schemas = {
      assertAvailable: (schema: string) => {
        if (
          ![
            fixture.schema,
            fixture.otherSchema,
            fixture.coreSchema,
            'core_schema',
          ].includes(schema)
        )
          throw new NotFoundException('Proceso fuera del harness');
        return Promise.resolve();
      },
      getCurrent: () => Promise.resolve({ name: fixture.schema }),
      getAllWithCache: () =>
        Promise.resolve(
          Object.values(processes).map(({ process: name }) => ({ name })),
        ),
    };
    const module = await Test.createTestingModule({
      controllers: [
        AuthController,
        RuntimeConfigController,
        ClassSessionRecordsController,
        SessionFilesController,
        ClassController,
        HourSessionController,
      ],
      providers: [
        AuthService,
        JwtStrategy,
        JwtAuthGuard,
        AuthorizationGuard,
        AuthGlobalGuard,
        SchemaManagerInterceptor,
        PrismaExceptionInterceptor,
        ClassSessionRecordsService,
        SessionJournalService,
        SessionFollowupService,
        SessionReportsService,
        SessionFilesService,
        SessionObjectStorage,
        ClassService,
        HourSessionService,
        ScheduleService,
        { provide: JwtService, useValue: jwt },
        { provide: PrismaService, useValue: fixture.apiPrisma },
        { provide: RequestContext, useValue: fixture.context },
        { provide: ConfigService, useValue: config },
        { provide: SchemaManagerService, useValue: schemas },
        {
          provide: RuntimeConfigService,
          useValue: { getCurrent: () => Promise.resolve(runtime) },
        },
        {
          provide: PermissionsService,
          useValue: { checkPermission: () => Promise.resolve(false) },
        },
        { provide: TokenRevocationService, useValue: revocations },
        { provide: OAuthStateStore, useValue: { clear: () => undefined } },
        {
          provide: SyncAuthorizationService,
          useValue: {
            syncAuthorization: () => {
              throw new ForbiddenException('No disponible en harness');
            },
          },
        },
      ],
    }).compile();
    const app = module.createNestApplication({ logger: ['error', 'warn'] });
    // ponytail: one held response per harness; use request IDs if parallel holds become necessary.
    let holdNextUpload = false;
    let heldResponse: Response | null = null;
    let heldEnd: (() => void) | null = null;
    const releaseUpload = () => {
      const complete = heldEnd;
      if (!complete) return false;
      heldEnd = null;
      heldResponse = null;
      complete();
      return true;
    };
    closeApp = () => {
      holdNextUpload = false;
      releaseUpload();
      heldResponse = null;
      return app.close();
    };
    configureApp(app);
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if ('x-schema' in req.headers)
        return next(new BadRequestException('Selección de esquema prohibida'));
      fixture.context.run({}, next);
    });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (
        holdNextUpload &&
        req.method === 'POST' &&
        req.path === '/api/class-session-files/records/5'
      ) {
        holdNextUpload = false;
        heldResponse = res;
        const end = res.end.bind(res) as Response['end'];
        // Retain only the response's final callback in memory; never read/replay multipart.
        res.end = ((...args: Parameters<Response['end']>) => {
          res.end = end;
          if (heldResponse !== res || res.destroyed) return end(...args);
          heldEnd = () => {
            end(...args);
          };
          return res;
        }) as Response['end'];
        res.once('close', () => {
          if (heldResponse === res) {
            heldResponse = null;
            heldEnd = null;
          }
        });
      }
      next();
    });
    // No OAuth provider or external authentication is installed in this test application.
    app.use('/api/auth/google', (_req: Request, res: Response) => {
      res.sendStatus(404);
    });
    app.useGlobalGuards(module.get(AuthGlobalGuard));
    app.useGlobalInterceptors(
      module.get(SchemaManagerInterceptor),
      module.get(PrismaExceptionInterceptor),
    );

    const records = module.get(ClassSessionRecordsService);
    const journal = module.get(SessionJournalService);
    const files = module.get(SessionFilesService);
    const inProcess = <T>(schema: string, work: () => Promise<T>) =>
      fixture.context.run(
        {
          schema,
          routing: { adminSchema: schema, userSchema: schema },
        },
        work,
      );
    const storage = new Storage({
      projectId: 'cepr-local',
      apiEndpoint: process.env.STORAGE_EMULATOR_HOST,
      useAuthWithCustomEndpoint: false,
    });
    storage.baseUrl = `${process.env.STORAGE_EMULATOR_HOST}/storage/v1`;
    await storage.createBucket(bucket);
    await fixture.client(fixture.coreSchema).userProfile.create({
      data: {
        userId: fixture.principals.admin.userId,
        firstName: 'Administración',
        lastName: 'Ficticia',
        phonesAdditional: [],
      },
    });

    for (const [label, entry] of Object.entries(processes)) {
      const db = fixture.client(entry.process);
      if (label === 'b') {
        for (const [name, p] of Object.entries(fixture.principals))
          if (name !== 'admin')
            await db.user.upsert({
              where: { id: p.userId },
              create: { id: p.userId, email: p.email, role: p.role },
              update: {},
            });
        await db.area.create({ data: { id: 1, name: 'Área ficticia' } });
        await db.course.create({ data: { id: 1, name: 'Curso ficticio' } });
        await db.sede.create({ data: { id: 1, name: 'Sede ficticia' } });
        await db.shift.create({ data: { id: 1, name: 'Turno ficticio' } });
        await db.hourSession.create({
          data: {
            id: 1,
            shiftId: 1,
            period: 1,
            startTime: new Date('1970-01-01T08:00Z'),
            endTime: new Date('1970-01-01T08:40Z'),
          },
        });
        await db.supervisor.createMany({
          data: [
            {
              id: fixture.supervisorId,
              userId: fixture.principals.supervisor.userId,
            },
            { userId: fixture.principals.otherSupervisor.userId },
          ],
        });
        await db.class.create({
          data: {
            id: fixture.classId,
            name: 'Aula ficticia B',
            idSede: 1,
            areaId: 1,
            shiftId: 1,
          },
        });
      }
      for (const [name, p] of Object.entries(fixture.principals))
        if (name !== 'admin')
          await db.userProfile.create({
            data: {
              userId: p.userId,
              firstName: name,
              lastName: `Prueba ${label.toUpperCase()}`,
              phonesAdditional: [],
            },
          });
      await db.monitor.createMany({
        data: [
          {
            id: ids.monitor,
            userId: fixture.principals.monitor.userId,
            supervisorId: fixture.supervisorId,
          },
          {
            id: ids.otherMonitor,
            userId: fixture.principals.otherMonitor.userId,
            supervisorId: fixture.supervisorId,
          },
        ],
      });
      await db.class.update({
        where: { id: fixture.classId },
        data: {
          monitorId: ids.monitor,
          name: `Aula ficticia ${label.toUpperCase()}`,
        },
      });
      const replacement = await db.user.create({
        data: {
          email: 'reemplazante@browser.invalid',
          role: 'profesor',
          userProfile: {
            create: {
              firstName: 'Docente',
              lastName: 'Reemplazante ficticio',
              phonesAdditional: [],
            },
          },
        },
      });
      await db.teacher.createMany({
        data: [
          {
            id: ids.teacher,
            userId: fixture.principals.teacher.userId,
            courseId: 1,
            jobStatus: 'PartTime',
          },
          {
            id: ids.replacementTeacher,
            userId: replacement.id,
            courseId: 1,
            jobStatus: 'PartTime',
          },
        ],
      });
      await db.shift.update({
        where: { id: 1 },
        data: {
          startTime: new Date('1970-01-01T08:00Z'),
          endTime: new Date('1970-01-01T23:59Z'),
        },
      });
      const date = limaDate();
      await db.sessionOperationalConfig.update({
        where: { id: 1 },
        data: {
          enabled: true,
          startsOn: new Date(date),
          endsOn: new Date(+new Date(date) + 90 * 86400000),
          latenessToleranceMinutes: 5,
          replacementWaitMinutes: null,
          alertThresholdMinutes: 0,
          continuityGapMinutes: 10,
        },
      });
      for (const [index, name] of scenarioNames.entries()) {
        const hourSessionId = index + 1;
        if (index)
          await db.hourSession.create({
            data: {
              id: hourSessionId,
              shiftId: 1,
              period: hourSessionId,
              startTime: new Date(
                `1970-01-01T${String(8 + index).padStart(2, '0')}:00Z`,
              ),
              endTime: new Date(
                `1970-01-01T${String(8 + index).padStart(2, '0')}:40Z`,
              ),
            },
          });
        const now = Date.now();
        const start = new Date(
          now + (name === 'future' ? 60 : -300 + index * 40) * 60000,
        );
        const shiftEnd = new Date(
          now + (name === 'closed' ? -180 : 120) * 60000,
        );
        const record = await db.classSessionRecord.create({
          data: {
            date: new Date(date),
            classId: fixture.classId,
            hourSessionId,
            shiftId: 1,
            areaId: 1,
            courseId: 1,
            scheduledStart: start,
            scheduledEnd: new Date(+start + 40 * 60000),
            shiftEnd,
            editDeadline: new Date(+shiftEnd + 90 * 60000),
            period: hourSessionId,
            pedagogicalMinutes: 40,
            titularTeacherId: ids.teacher,
            titularMonitorId: ids.monitor,
            monitorAccountId: fixture.principals.monitor.userId,
            supervisorId: fixture.supervisorId,
            snapshot: {
              className: `Aula ficticia ${label.toUpperCase()}`,
              area: 'Área ficticia',
              shift: 'Turno ficticio',
              course: 'Curso ficticio',
              teacher: {
                id: ids.teacher,
                name: 'Docente ficticio',
                email: fixture.principals.teacher.email,
              },
              monitor: {
                id: ids.monitor,
                name: 'Monitor ficticio',
                email: fixture.principals.monitor.email,
              },
            },
            timingPolicy: {
              version: 1,
              latenessToleranceMinutes: 5,
              replacementWaitMinutes: null,
              alertThresholdMinutes: 0,
              continuityGapMinutes: 10,
            },
          },
        });
        entry.records[name] = record.id;
        await inProcess(entry.process, async () => {
          if (name === 'evidence') {
            let updated = await records.update(
              fixture.principals.monitor,
              record.id,
              {
                expectedVersion: record.version,
                actualStart: start.toISOString(),
                actualEnd: record.scheduledEnd.toISOString(),
                teachingStatus: 'TAUGHT',
                titularOutcome: 'PRESENT',
                effectiveTeacherId: ids.teacher,
                effectiveMonitorId: ids.monitor,
              },
            );
            for (const slot of ['initial', 'final']) {
              const file = await files.upload(
                fixture.principals.monitor,
                record.id,
                uploadFixture({ originalname: `captura-ficticia-${slot}.png` }),
              );
              updated = await files.associate(
                fixture.principals.monitor,
                record.id,
                slot,
                { expectedVersion: updated.version, fileId: file.id },
              );
            }
            await journal.review(fixture.principals.supervisor, record.id, {
              expectedVersion: updated.version,
              result: 'CONFORMING',
              comments: 'Revisión ficticia inicial',
              confirmed: true,
            });
          }
          if (name === 'pendingReplacement' || name === 'authorizedReplacement')
            await journal.cover(
              fixture.principals[
                name === 'pendingReplacement' ? 'monitor' : 'admin'
              ],
              {
                targets: [
                  { recordId: record.id, expectedVersion: record.version },
                ],
                kind: 'TEACHER',
                personId: ids.replacementTeacher,
                mode: name === 'pendingReplacement' ? 'EMERGENCY' : 'PLANNED',
                reason: 'Cobertura ficticia de prueba',
              },
            );
        });
      }
      await module.get(SessionFollowupService).generate(entry.process);
    }
    const manifest = {
      origin: 'http://127.0.0.1:3000',
      date: limaDate(),
      processes,
      ids,
      classId: fixture.classId,
      accounts: Object.fromEntries(
        Object.entries(fixture.principals).map(([role, p]) => [
          role,
          { accountId: p.userId, email: p.email, role: p.role },
        ]),
      ),
    };
    app.use('/__test', (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        const origin = req.headers.origin;
        if (
          !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '') ||
          req.headers['sec-fetch-site'] === 'cross-site' ||
          (origin &&
            origin !== frontend &&
            origin !== `http://${req.headers.host}`)
        )
          throw new ForbiddenException('Control solo local');
        res.setHeader('Cache-Control', 'private, no-store');
        if (req.method === 'GET' && req.path === '/fixtures') {
          res.json(manifest);
          return;
        }
        if (req.method === 'GET' && req.path === '/held-upload') {
          res.json({
            held: !!heldEnd,
            ...(heldEnd && heldResponse
              ? { status: heldResponse.statusCode }
              : {}),
          });
          return;
        }
        if (
          req.path === '/hold-upload' &&
          (req.method === 'GET' || req.method === 'POST')
        ) {
          if (req.query.enabled !== 'true' && req.query.enabled !== 'false')
            throw new BadRequestException('enabled obligatorio');
          if (heldResponse && req.query.enabled === 'true')
            throw new ConflictException(
              'Ya existe una subida pendiente de liberación',
            );
          holdNextUpload = req.query.enabled === 'true';
          res.json({ enabled: holdNextUpload });
          return;
        }
        if (req.method === 'GET' && req.path === '/session') {
          const role = req.query.role;
          if (
            typeof role !== 'string' ||
            !Object.hasOwn(fixture.principals, role)
          )
            throw new BadRequestException('Rol ficticio inválido');
          const p = fixture.principals[role];
          const schema =
            role === 'admin' ? 'core_schema' : runtime.schemaRouting.userSchema;
          const token = jwt.sign(
            { id: p.userId, email: p.email, role: p.role, schema },
            {
              jwtid: randomUUID(),
              expiresIn: '8h',
              issuer: 'cepr',
              audience: 'cepr-api',
            },
          );
          setSessionCookie(res, token, false, 8 * 3600);
          res.json({ authenticated: true, role: p.role });
          return;
        }
        if (req.method !== 'POST') throw new NotFoundException();
        if (req.path === '/release-upload') {
          res.json({ released: releaseUpload() });
          return;
        }
        if (req.path === '/maintenance') {
          if (req.query.enabled !== 'true' && req.query.enabled !== 'false')
            throw new BadRequestException('enabled obligatorio');
          runtime.maintenance.enabled = req.query.enabled === 'true';
          res.json({ maintenance: runtime.maintenance.enabled });
          return;
        }
        const key = req.query.process ?? 'a';
        if (key !== 'a' && key !== 'b')
          throw new BadRequestException('Proceso ficticio a/b');
        const entry = processes[key];
        if (req.path === '/process') {
          const audience = req.query.audience ?? 'both';
          if (
            audience !== 'admin' &&
            audience !== 'user' &&
            audience !== 'both'
          )
            throw new BadRequestException('audience inválida');
          if (audience !== 'user')
            runtime.schemaRouting.adminSchema = entry.process;
          if (audience !== 'admin')
            runtime.schemaRouting.userSchema = entry.process;
          res.json({ ...runtime.schemaRouting });
          return;
        }
        const id = Number(req.query.recordId);
        if (!Object.values(entry.records).includes(id))
          throw new BadRequestException('Parte fuera del fixture');
        if (req.path === '/close') {
          await fixture.client(entry.process)
            .$executeRaw`UPDATE class_session_records SET scheduled_start=clock_timestamp()-interval '4 hours',scheduled_end=clock_timestamp()-interval '3 hours',shift_end=clock_timestamp()-interval '3 hours',edit_deadline=clock_timestamp()-interval '90 minutes' WHERE id=${id}`;
          res.json({ recordId: id, closed: true });
          return;
        }
        if (req.path === '/concurrent') {
          const updated = await inProcess(entry.process, async () => {
            const record = await records.detail(fixture.principals.admin, id);
            return records.update(
              fixture.principals.admin,
              id,
              {
                expectedVersion: record.version,
                incidents: `Edición concurrente ficticia ${record.version + 1}`,
                reason: 'Conflicto provocado por harness local',
              },
              true,
            );
          });
          res.json({ recordId: id, version: updated.version });
          return;
        }
        throw new NotFoundException();
      })().catch(next);
    });
    await app.init();
    return {
      app,
      manifest,
      close: async () => {
        await closeApp?.();
        await fixture.close();
      },
    };
  } catch (error) {
    await closeApp?.();
    await fixture.close();
    throw error;
  }
}
