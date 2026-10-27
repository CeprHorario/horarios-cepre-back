export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  REDIRECT_FRONT: string;
  DB_POOL_MAX: number;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: number;
}

function positiveInteger(
  name: string,
  value: unknown,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} debe ser un entero entre 1 y ${max}`);
  }
  return parsed;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): Environment & Record<string, unknown> {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (
    typeof nodeEnv !== 'string' ||
    !['development', 'test', 'production'].includes(nodeEnv)
  ) {
    throw new Error('NODE_ENV debe ser development, test o production');
  }

  const databaseUrl = environment.DATABASE_URL;
  if (
    typeof databaseUrl !== 'string' ||
    !URL.canParse(databaseUrl) ||
    !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)
  ) {
    throw new Error('DATABASE_URL debe ser una URL de PostgreSQL válida');
  }

  const frontend = environment.REDIRECT_FRONT ?? 'http://localhost:5173';
  if (
    typeof frontend !== 'string' ||
    !URL.canParse(frontend) ||
    !['http:', 'https:'].includes(new URL(frontend).protocol)
  ) {
    throw new Error('REDIRECT_FRONT debe ser una URL HTTP o HTTPS válida');
  }
  const frontendUrl = new URL(frontend);
  if (
    ['storage.googleapis.com', 'storage.cloud.google.com'].includes(
      frontendUrl.hostname,
    ) ||
    frontendUrl.username ||
    frontendUrl.password ||
    (nodeEnv === 'production' && frontendUrl.protocol !== 'https:')
  )
    throw new Error(
      'REDIRECT_FRONT requiere un origen exclusivo y HTTPS en producción',
    );
  if (
    environment.SESSION_SAME_SITE !== undefined &&
    (typeof environment.SESSION_SAME_SITE !== 'string' ||
      !['lax', 'none'].includes(environment.SESSION_SAME_SITE))
  )
    throw new Error('SESSION_SAME_SITE debe ser lax o none');
  if (environment.SESSION_SAME_SITE === 'none' && nodeEnv !== 'production')
    throw new Error('SESSION_SAME_SITE=none requiere HTTPS de producción');
  const secret = environment.JWT_SECRET;
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret) < 32 ||
    /^(replace-|change-me|default_secret)/i.test(secret)
  ) {
    throw new Error(
      'JWT_SECRET debe ser un secreto propio de al menos 32 bytes',
    );
  }
  const configuredDuration = environment.JWT_EXPIRES_IN ?? '8h';
  const duration =
    typeof configuredDuration === 'string' ||
    typeof configuredDuration === 'number'
      ? String(configuredDuration).match(/^([1-9]\d*)(s|m|h|d)?$/)
      : null;
  const seconds = duration
    ? Number(duration[1]) *
      { s: 1, m: 60, h: 3600, d: 86400 }[duration[2] ?? 's']!
    : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 1)
    throw new Error(
      'JWT_EXPIRES_IN debe ser una duración positiva en segundos, m, h o d',
    );

  return {
    ...environment,
    NODE_ENV: nodeEnv as Environment['NODE_ENV'],
    PORT: positiveInteger('PORT', environment.PORT, 8080, 65535),
    DATABASE_URL: databaseUrl,
    REDIRECT_FRONT: new URL(frontend).origin,
    JWT_SECRET: secret,
    JWT_EXPIRES_IN: seconds,
    DB_POOL_MAX: positiveInteger(
      'DB_POOL_MAX',
      environment.DB_POOL_MAX,
      5,
      100,
    ),
  };
}
