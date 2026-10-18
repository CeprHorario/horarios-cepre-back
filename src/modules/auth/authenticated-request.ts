import type { Request } from 'express';
import type { JwtStrategy } from './strategies/jwt.strategy';

export type AuthenticatedRequest = Request & {
  user: Awaited<ReturnType<JwtStrategy['validate']>>;
};
