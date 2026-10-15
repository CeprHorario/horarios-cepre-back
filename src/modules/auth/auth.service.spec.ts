import { AuthService } from './auth.service';
import { Role } from './decorators/authorization.decorator';

describe('AuthService schema-aware Google login', () => {
  const coreFind = jest.fn();
  const userFind = jest.fn();
  const prisma = {
    getClientForSchema: jest.fn((schema: string) => ({
      user: { findUnique: schema === 'core_schema' ? coreFind : userFind },
    })),
  };
  const jwt = { sign: jest.fn(() => 'signed-token') };
  const config = { get: jest.fn(() => 'core_schema') };
  const runtimeConfig = {
    getCurrent: jest.fn().mockResolvedValue({
      schemaRouting: { userSchema: 'users_2026' },
    }),
  };
  const service = new AuthService(
    prisma as never,
    jwt as never,
    config as never,
    runtimeConfig as never,
  );
  const profile = { emails: [{ value: 'person@unsa.edu.pe' }] };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('authenticates administrators from the core schema', async () => {
    coreFind.mockResolvedValue({
      id: 'admin-id',
      email: 'person@unsa.edu.pe',
      role: Role.ADMIN,
    });

    await expect(service.validateGoogleUser(profile)).resolves.toEqual({
      token: 'signed-token',
    });
    expect(prisma.getClientForSchema).toHaveBeenCalledWith('core_schema');
    expect(runtimeConfig.getCurrent).not.toHaveBeenCalled();
    expect(userFind).not.toHaveBeenCalled();
  });

  it('authenticates non-admin users from the configured user schema', async () => {
    coreFind.mockResolvedValue(null);
    userFind.mockResolvedValue({
      id: 'teacher-id',
      email: 'person@unsa.edu.pe',
      role: Role.TEACHER,
    });

    await expect(service.validateGoogleUser(profile)).resolves.toEqual({
      token: 'signed-token',
    });
    expect(prisma.getClientForSchema).toHaveBeenCalledWith('users_2026');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.TEACHER }),
      expect.any(Object),
    );
  });

  it('does not issue a token when the user is absent from the routed schemas', async () => {
    coreFind.mockResolvedValue(null);
    userFind.mockResolvedValue(null);
    await expect(service.validateGoogleUser(profile)).resolves.toEqual({});
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
