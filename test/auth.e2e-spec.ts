import { Controller, Get, Post, INestApplication, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Server } from 'node:http';
import type { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { RuntimeConfigService } from '../src/modules/runtime-config/runtime-config.service';
import { PermissionsService } from '../src/modules/permissions/permissions.service';
import {
  Authorization,
  Role,
} from '../src/modules/auth/decorators/authorization.decorator';
import { MaintenanceBypass } from '../src/modules/runtime-config/decorators/maintenance-bypass.decorator';
import { SchemaRoutingBypass } from '../src/database/schema-manager/schema-routing-bypass.decorator';
import { GoogleStrategy } from '../src/modules/auth/strategies/google.strategy';
import { getCoordinatorCourseId } from '../src/modules/auth/utils/coordinator-role';

@Controller('auth-probe')
class AuthProbeController {
  @Get('course')
  @Authorization({ permission: 'courses.list' })
  course(@Req() req: Request & { user: { role: string } }) {
    return { courseId: getCoordinatorCourseId(req.user.role) };
  }
  @Post('write')
  @Authorization({ roles: [Role.COORDINATOR], permission: 'schedule.delete' })
  write() {
    return { ok: true };
  }
  @Get('bypass')
  @MaintenanceBypass()
  @SchemaRoutingBypass()
  @Authorization({ roles: [Role.MONITOR], permission: 'probe.read' })
  bypass() {
    return { ok: true };
  }
}

describe('Authentication boundaries', () => {
  let app: INestApplication<Server>;
  let jwt: JwtService;
  let config: ConfigService;
  const admin = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'admin@example.com',
    role: 'administrador',
    isActive: true,
    userProfile: { firstName: 'Admin', lastName: 'Core' },
  };
  const user = {
    ...admin,
    id: '00000000-0000-4000-8000-000000000002',
    email: 'user@example.com',
    role: 'coordinador-10',
    userProfile: { firstName: 'Course', lastName: 'Ten' },
  };
  let userSchema: string;
  let maintenance: boolean;
  const read = jest.fn(
    (schema: string, where: { id?: string; email?: string }) =>
      Promise.resolve(
        [...(schema === 'core_schema' ? [admin] : [user])].find(
          (row) => row.id === where.id || row.email === where.email,
        ) ?? null,
      ),
  );
  const permission = jest.fn(() => Promise.resolve(false));
  const exchange = jest.fn();
  const token = (row = user, overrides = {}) =>
    jwt.sign({
      id: row.id,
      email: row.email,
      role: row.role,
      schema: row === admin ? 'core_schema' : 'alpha',
      ...overrides,
    });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue({
        getClientForSchema: (schema: string) => ({
          user: {
            findUnique: ({
              where,
            }: {
              where: { id?: string; email?: string };
            }) => read(schema, where),
          },
        }),
      })
      .overrideProvider(SchemaManagerService)
      .useValue({
        assertAvailable: () => Promise.resolve(),
        getCurrent: () => Promise.resolve({ name: 'alpha' }),
      })
      .overrideProvider(PermissionsService)
      .useValue({ checkPermission: permission })
      .overrideProvider(RuntimeConfigService)
      .useValue({
        getCurrent: () =>
          Promise.resolve({
            version: 1,
            maintenance: {
              enabled: maintenance,
              message: 'Maintenance',
              endsAt: null,
            },
            schemaRouting: { adminSchema: 'admin_data', userSchema },
          }),
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    const google = app.get<unknown>(GoogleStrategy) as {
      _oauth2: { getOAuthAccessToken: (...args: unknown[]) => void };
      userProfile: (
        access: string,
        done: (error: null, profile: object) => void,
      ) => void;
    };
    google._oauth2.getOAuthAccessToken = exchange.mockImplementation(
      (
        _code: string,
        _params: unknown,
        done: (
          error: null,
          access: string,
          refresh: string,
          params: object,
        ) => void,
      ) => done(null, 'test-oauth-access', 'test-oauth-refresh', {}),
    );
    google.userProfile = (_access, done) =>
      done(null, {
        id: 'google-user',
        provider: 'google',
        displayName: 'Test',
        emails: [{ value: user.email, verified: true }],
      });
  });
  beforeEach(() => {
    userSchema = 'alpha';
    maintenance = false;
    user.role = 'coordinador-10';
    user.isActive = true;
    admin.isActive = true;
    permission.mockResolvedValue(false);
    read.mockClear();
    exchange.mockClear();
  });
  afterAll(async () => {
    await app.close();
  });

  it('preserves rawRole and course scope; admin identity is only read from core', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/user-info')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(response.body).toMatchObject({
      role: 'coordinador',
      rawRole: 'coordinador-10',
      coordinatorCourseId: 10,
      firstName: 'Course',
    });
    await request(app.getHttpServer())
      .get('/api/auth-probe/course')
      .auth(token(), { type: 'bearer' })
      .expect(200)
      .expect({ courseId: 10 });
    await request(app.getHttpServer())
      .post('/api/auth-probe/write')
      .auth(token(), { type: 'bearer' })
      .expect(401);
    read.mockClear();
    await request(app.getHttpServer())
      .get('/api/auth/user-info')
      .auth(token(admin), { type: 'bearer' })
      .expect(200);
    expect(read.mock.calls.map(([schema]) => schema)).toEqual(['core_schema']);
  });

  it('rejects identical IDs in another process, changed roles and inactive users', async () => {
    const session = token();
    userSchema = 'beta';
    await request(app.getHttpServer())
      .get('/api/auth/user-info')
      .auth(session, { type: 'bearer' })
      .expect(401);
    expect(read).not.toHaveBeenCalled();
    userSchema = 'alpha';
    user.role = 'coordinador-11';
    await request(app.getHttpServer())
      .get('/api/auth/user-info')
      .auth(session, { type: 'bearer' })
      .expect(401);
    user.isActive = false;
    await request(app.getHttpServer())
      .get('/api/auth/user-info')
      .auth(token(), { type: 'bearer' })
      .expect(401);
  });

  it('requires expiration, signature, schema, audience and HS256', async () => {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      schema: 'alpha',
    };
    const withoutExpiry = new JwtService({
      secret: config.getOrThrow<string>('JWT_SECRET'),
    }).sign(payload, {
      algorithm: 'HS256',
      issuer: 'cepr',
      audience: 'cepr-api',
    });
    for (const invalid of [
      withoutExpiry,
      jwt.sign(payload, { expiresIn: -1 }),
      jwt.sign(payload, { algorithm: 'HS384' }),
      jwt.sign(payload, { audience: 'cepr-oauth-state' }),
      token(user, { schema: undefined }),
      token() + 'corrupted',
    ]) {
      await request(app.getHttpServer())
        .get('/api/auth/user-info')
        .auth(invalid, { type: 'bearer' })
        .expect(401);
    }
  });

  it.each([
    'profesor',
    'supervisor',
    'monitor',
    'coordinador',
    'coordinador-10',
  ])('preserves user-info access for %s', async (role) => {
    user.role = role;
    const response = await request(app.getHttpServer())
      .get('/api/auth/user-info')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    const info = response.body as {
      rawRole: string;
      coordinatorCourseId: number | null;
    };
    expect(info.rawRole).toBe(role);
    expect(info.coordinatorCourseId).toBe(
      role === 'coordinador-10' ? 10 : null,
    );
    if (role.startsWith('coordinador')) {
      permission.mockResolvedValue(true);
      await request(app.getHttpServer())
        .post('/api/auth-probe/write')
        .auth(token(), { type: 'bearer' })
        .expect(401);
    }
  });

  it('maintenance bypass still requires authentication; roles OR DB grants remain valid', async () => {
    maintenance = true;
    await request(app.getHttpServer())
      .get('/api/auth-probe/bypass')
      .expect(401);
    user.role = 'monitor';
    await request(app.getHttpServer())
      .get('/api/auth-probe/bypass')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/user-info')
      .auth(token(), { type: 'bearer' })
      .expect(503);
    await request(app.getHttpServer())
      .get('/api/auth/user-info')
      .auth(token(admin), { type: 'bearer' })
      .expect(200);
    maintenance = false;
    await request(app.getHttpServer())
      .post('/api/auth-probe/write')
      .auth(token(), { type: 'bearer' })
      .expect(401);
    permission.mockResolvedValue(true);
    await request(app.getHttpServer())
      .post('/api/auth-probe/write')
      .auth(token(), { type: 'bearer' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/sync-authorizations')
      .auth(token(), { type: 'bearer' })
      .expect(401);
  });

  it('binds OAuth state to the initiating browser and returns a no-store popup', async () => {
    const start = await request(app.getHttpServer())
      .get('/api/auth/google')
      .expect(302);
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const cookies = start.headers['set-cookie'] as unknown as string[];
    expect(cookies[0]).toMatch(/HttpOnly/);
    expect(cookies[0]).toMatch(/SameSite=Lax/);
    const callback = `/api/auth/google/redirect?code=test-code&state=${state}`;
    const denied = await request(app.getHttpServer()).get(callback).expect(200);
    expect(denied.text).toContain('error_authenticating');
    expect(exchange).not.toHaveBeenCalled();
    const success = await request(app.getHttpServer())
      .get(callback)
      .set('Cookie', cookies)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(success.text).toContain('http://localhost:5173');
    expect(success.text).not.toContain('"*"');
    expect(success.text).toContain('window.opener &&');
    const issued = /"token":"([^"]+)"/.exec(success.text)?.[1];
    expect(issued).toBeDefined();
    const claims = jwt.verify<{
      schema: string;
      role: string;
      exp: number;
      iat: number;
    }>(issued!);
    expect(claims.schema).toBe('alpha');
    expect(claims.role).toBe('coordinador-10');
    expect(claims.exp - claims.iat).toBe(28800);
    exchange.mockClear();
    const expiredCookie =
      'cepr-oauth=' +
      jwt.sign(
        { nonce: state, schema: 'alpha' },
        { audience: 'cepr-oauth-state', expiresIn: -1 },
      );
    for (const invalidCookie of [
      'cepr-oauth=invalid-signature',
      expiredCookie,
    ]) {
      expect(
        (
          await request(app.getHttpServer())
            .get(callback)
            .set('Cookie', invalidCookie)
            .expect(200)
        ).text,
      ).toContain('error_authenticating');
    }
    expect(exchange).not.toHaveBeenCalled();
    exchange.mockImplementationOnce(
      (_code: string, _params: unknown, done: (error: Error) => void) =>
        done(new Error('test-oauth-access test-oauth-refresh')),
    );
    const failedExchange = await request(app.getHttpServer())
      .get(callback)
      .set('Cookie', cookies)
      .expect(200);
    expect(failedExchange.text).toContain('error_authenticating');
    expect(failedExchange.text).not.toMatch(
      /test-oauth-access|test-oauth-refresh/,
    );
    for (const suffix of [
      '?error=access_denied',
      '?code=test-code&state=wrong',
      '',
    ]) {
      const response = await request(app.getHttpServer())
        .get('/api/auth/google/redirect' + suffix)
        .set('Cookie', cookies)
        .expect(200);
      expect(response.text).toContain('error_authenticating');
    }
    userSchema = 'beta';
    exchange.mockClear();
    expect(
      (
        await request(app.getHttpServer())
          .get(callback)
          .set('Cookie', cookies)
          .expect(200)
      ).text,
    ).toContain('error_authenticating');
    expect(exchange).not.toHaveBeenCalled();
  });
});
