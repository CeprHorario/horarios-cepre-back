import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { sessionCookieToken } from './modules/auth/session-cookie';
import { requestLimits } from './security/request-limits';
import { auditHttp } from './security/audit-http';

export function configureApp(app: INestApplication): void {
  const frontend = app.get(ConfigService).getOrThrow<string>('REDIRECT_FRONT');
  const production =
    app.get(ConfigService).get<string>('NODE_ENV') === 'production';
  app.use(auditHttp());
  app.use(requestLimits());
  app.use(
    helmet({
      crossOriginOpenerPolicy: false,
      contentSecurityPolicy: production
        ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }
        : false,
    }),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (
      req.headers['content-encoding'] &&
      req.headers['content-encoding'] !== 'identity'
    ) {
      res.status(415).json({
        statusCode: 415,
        message: 'No se aceptan cuerpos comprimidos',
      });
      return;
    }
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      sessionCookieToken(req, production) &&
      !/^Bearer \S+$/i.test(req.headers.authorization ?? '') &&
      (req.headers.origin !== new URL(frontend).origin ||
        req.headers['x-requested-with'] !== 'ceprunsa')
    ) {
      res.status(403).json({
        statusCode: 403,
        message: 'Origen o protección CSRF inválidos',
      });
      return;
    }
    next();
  });

  app.enableCors({
    origin: [new URL(frontend).origin],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (production) return;
  const config = new DocumentBuilder()
    .setTitle('CEPRE - API')
    .setDescription('API de gestión de horarios CEPRE')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(
    'swagger',
    app,
    () => SwaggerModule.createDocument(app, config),
    { jsonDocumentUrl: 'swagger/json' },
  );
}
