import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureApp(app: INestApplication): void {
  const frontend = app.get(ConfigService).getOrThrow<string>('REDIRECT_FRONT');

  app.enableCors({
    origin: [new URL(frontend).origin, 'https://storage.googleapis.com'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization'],
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
