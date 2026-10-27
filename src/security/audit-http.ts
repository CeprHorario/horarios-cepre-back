import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/** Only allowlisted metadata. Never serialize headers, bodies, query strings or full user objects. */
export function auditHttp() {
  const logger = new Logger('SecurityAudit');
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.once('finish', () => {
      const actor = req.user;
      if (
        !actor &&
        res.statusCode < 400 &&
        !req.path.startsWith('/api/auth/google')
      )
        return;
      const route = req.route as { path?: unknown } | undefined;
      const event = JSON.stringify({
        requestId,
        actorId: actor && 'userId' in actor && typeof actor.userId === 'string' ? actor.userId : null,
        role: actor && 'role' in actor && typeof actor.role === 'string' ? actor.role : null,
        method: req.method,
        route: typeof route?.path === 'string' ? route.path : 'unmatched',
        status: res.statusCode,
      });
      if (res.statusCode >= 400) logger.warn(event);
      else logger.log(event);
    });
    next();
  };
}
