import { ServiceUnavailableException } from '@nestjs/common';
import { AuthGlobalGuard } from './auth-global.guard';
import { Role } from '../decorators/authorization.decorator';
import { MAINTENANCE_BYPASS_KEY } from '@modules/runtime-config/decorators/maintenance-bypass.decorator';
import { IS_PUBLIC_KEY } from '../decorators/unauthenticated.decorator';

describe('AuthGlobalGuard maintenance mode', () => {
  const request = { user: undefined as undefined | { role: string } };
  const response = { setHeader: jest.fn() };
  const metadata = new Map<string, boolean>();
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata.get(key) ?? false),
  };
  const jwtGuard = { canActivate: jest.fn().mockResolvedValue(true) };
  const authorizationGuard = { canActivate: jest.fn().mockResolvedValue(true) };
  const runtimeConfig = { getCurrent: jest.fn() };
  const guard = new AuthGlobalGuard(
    reflector as never,
    jwtGuard as never,
    authorizationGuard as never,
    runtimeConfig as never,
  );
  const context = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    metadata.clear();
    request.user = undefined;
    runtimeConfig.getCurrent.mockResolvedValue({
      maintenance: { enabled: true, message: 'Pausa técnica', endsAt: null },
    });
  });

  it('allows endpoints explicitly excluded from maintenance', async () => {
    metadata.set(MAINTENANCE_BYPASS_KEY, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(runtimeConfig.getCurrent).not.toHaveBeenCalled();
  });

  it('allows an authenticated administrator during maintenance', async () => {
    request.user = { role: Role.ADMIN };
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authorizationGuard.canActivate).toHaveBeenCalled();
  });

  it('blocks a non-administrator with HTTP 503 during maintenance', async () => {
    request.user = { role: Role.TEACHER };
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(authorizationGuard.canActivate).not.toHaveBeenCalled();
  });

  it('blocks public endpoints that are not explicitly excluded', async () => {
    metadata.set(IS_PUBLIC_KEY, true);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(jwtGuard.canActivate).not.toHaveBeenCalled();
  });

  it('uses the normal authorization chain when maintenance is disabled', async () => {
    runtimeConfig.getCurrent.mockResolvedValue({
      maintenance: { enabled: false },
    });
    request.user = { role: Role.TEACHER };
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtGuard.canActivate).toHaveBeenCalled();
    expect(authorizationGuard.canActivate).toHaveBeenCalled();
  });
});
