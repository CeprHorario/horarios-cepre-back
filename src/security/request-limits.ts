import type { Request, Response, NextFunction } from 'express';

/** Per-instance backstop; configure distributed limits at the production edge. */
export function requestLimits() {
  const windows = new Map<string, { count: number; until: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const bucket = req.path.startsWith('/api/auth/google')
      ? 'oauth'
      : req.path.startsWith('/api/schedules/public/')
        ? 'public-lookup'
        : /^\/api\/imports\/[^/]+\/(preview|apply)$/.test(req.path)
          ? 'imports'
          : null;
    if (!bucket) {
      next();
      return;
    }
    const key = `${req.socket.remoteAddress ?? 'unknown'}:${bucket}`,
      now = Date.now();
    let window = windows.get(key);
    if (!window || window.until <= now) {
      windows.delete(key);
      if (windows.size >= 4096) windows.delete(windows.keys().next().value!);
      window = { count: 0, until: now + 60000 };
      windows.set(key, window);
    }
    if (++window.count > (bucket === 'oauth' ? 300 : 30)) {
      res.setHeader(
        'Retry-After',
        String(Math.ceil((window.until - now) / 1000)),
      );
      res.status(429).json({
        statusCode: 429,
        message: 'Demasiadas solicitudes; intenta en un minuto',
      });
      return;
    }
    next();
  };
}
