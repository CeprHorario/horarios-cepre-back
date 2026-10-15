import { AsyncLocalStorage } from 'async_hooks';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { SchemaManagerInterceptor } from './schema-manager.interceptor';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { SCHEMA_ROUTING_BYPASS_KEY } from './schema-routing-bypass.decorator';

describe('SchemaManagerInterceptor', () => {
  const schemaManager = { schemaExists: jest.fn() };
  const runtimeConfig = { getCurrent: jest.fn() };
  const metadata = new Map<string, boolean>();
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata.get(key) ?? false),
  };
  const als = new AsyncLocalStorage<{ schema: string }>();
  const interceptor = new SchemaManagerInterceptor(
    schemaManager as never,
    runtimeConfig as never,
    als,
    reflector as never,
  );
  const next = {
    handle: jest.fn(() => of(als.getStore()?.schema)),
  };

  const context = (request: Record<string, unknown>) =>
    ({
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    metadata.clear();
    schemaManager.schemaExists.mockResolvedValue(true);
    runtimeConfig.getCurrent.mockResolvedValue({
      schemaRouting: { adminSchema: 'admin_2026', userSchema: 'users_2026' },
    });
  });

  it('bypasses schema resolution for endpoints that do not use SQL', async () => {
    metadata.set(SCHEMA_ROUTING_BYPASS_KEY, true);
    const stream = await interceptor.intercept(context({ headers: {} }), next);

    await expect(lastValueFrom(stream)).resolves.toBeUndefined();
    expect(runtimeConfig.getCurrent).not.toHaveBeenCalled();
    expect(schemaManager.schemaExists).not.toHaveBeenCalled();
  });

  it('routes administrators to the configured admin schema', async () => {
    const stream = await interceptor.intercept(
      context({ headers: {}, user: { role: Role.ADMIN } }),
      next,
    );

    await expect(lastValueFrom(stream)).resolves.toBe('admin_2026');
    expect(schemaManager.schemaExists).toHaveBeenCalledWith('admin_2026');
  });

  it('routes other users to the configured user schema', async () => {
    const stream = await interceptor.intercept(
      context({ headers: {}, user: { role: Role.TEACHER } }),
      next,
    );

    await expect(lastValueFrom(stream)).resolves.toBe('users_2026');
  });

  it('rejects client-controlled schema headers', async () => {
    await expect(
      interceptor.intercept(
        context({ headers: { 'x-schema': 'other' } }),
        next,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a configured schema that does not exist', async () => {
    schemaManager.schemaExists.mockResolvedValue(false);
    await expect(
      interceptor.intercept(
        context({ headers: {}, user: { role: Role.ADMIN } }),
        next,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps the legacy default when Firestore has no document', async () => {
    runtimeConfig.getCurrent.mockResolvedValue(null);
    const stream = await interceptor.intercept(context({ headers: {} }), next);

    await expect(lastValueFrom(stream)).resolves.toBe('default');
    expect(schemaManager.schemaExists).not.toHaveBeenCalled();
  });
});
