import { validateEnvironment } from './environment';

const databaseUrl = 'postgresql://test:test@localhost:5432/cepr';
const secret = 'test-secret-only-with-at-least-32-bytes';

describe('Variables de entorno', () => {
  it('aplica los valores por defecto sin descartar variables de otros módulos', () => {
    expect(
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        JWT_SECRET: secret,
        FUTURE_SETTING: 'value',
      }),
    ).toEqual({
      NODE_ENV: 'development',
      PORT: 8080,
      DATABASE_URL: databaseUrl,
      REDIRECT_FRONT: 'http://localhost:5173',
      DB_POOL_MAX: 5,
      JWT_SECRET: secret,
      JWT_EXPIRES_IN: 28800,
      FUTURE_SETTING: 'value',
    });
  });

  it('convierte los parámetros numéricos', () => {
    const config = validateEnvironment({
      DATABASE_URL: databaseUrl,
      JWT_SECRET: secret,
      PORT: '8081',
      DB_POOL_MAX: '3',
    });
    expect(config.PORT).toBe(8081);
    expect(config.DB_POOL_MAX).toBe(3);
  });

  it.each([undefined, '', 'https://example.com'])(
    'rechaza una conexión PostgreSQL inválida: %s',
    (DATABASE_URL) => {
      expect(() => validateEnvironment({ DATABASE_URL })).toThrow(
        'DATABASE_URL',
      );
    },
  );

  it('rechaza puertos, pools, entornos y orígenes inválidos', () => {
    for (const overrides of [
      { PORT: '0' },
      { DB_POOL_MAX: '-1' },
      { NODE_ENV: 'unknown' },
      { REDIRECT_FRONT: 'javascript:alert(1)' },
    ]) {
      expect(() =>
        validateEnvironment({
          DATABASE_URL: databaseUrl,
          JWT_SECRET: secret,
          ...overrides,
        }),
      ).toThrow();
    }
  });
  it('rechaza secretos ausentes, placeholders y duraciones inválidas', () => {
    for (const JWT_SECRET of [
      undefined,
      '',
      'default_secret',
      'replace-with-a-secret-longer-than-32',
    ])
      expect(() =>
        validateEnvironment({ DATABASE_URL: databaseUrl, JWT_SECRET }),
      ).toThrow('JWT_SECRET');
    for (const JWT_EXPIRES_IN of ['0', '-1h', 'garbage'])
      expect(() =>
        validateEnvironment({
          DATABASE_URL: databaseUrl,
          JWT_SECRET: secret,
          JWT_EXPIRES_IN,
        }),
      ).toThrow('JWT_EXPIRES_IN');
    expect(
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        JWT_SECRET: secret,
        JWT_EXPIRES_IN: '30m',
      }).JWT_EXPIRES_IN,
    ).toBe(1800);
  });
});
