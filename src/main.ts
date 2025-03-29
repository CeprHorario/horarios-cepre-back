import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app/app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [process.env.REDIRECT_FRONT], // O la URL del frontend en producción
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // API Principal
  const config = new DocumentBuilder()
    .setTitle('Project CPU - API Complete')
    .setDescription('Documentation of the entire project API')
    .setVersion('1.0')
    .addTag('CPU')
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('swagger', app, documentFactory, {
    jsonDocumentUrl: 'swagger/json',
  });

  //Configuración de prefijo global
  app.setGlobalPrefix('api');

  //Configuración de validación global
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Elimina propiedades que no están en el DTO
      forbidNonWhitelisted: true, // Rechaza la solicitud si hay propiedades adicionales
      transform: true, // Transforma el payload a la instancia de la clase DTO
      //transformOptions: {
      //  enableImplicitConversion: true, // Permite conversiones implícitas de tipos
      //},
    }),
  );
  const port = process.env.PORT || 8080;
  await app.listen(port, '0.0.0.0'); // Asegura que escuche en todas las interfaces
  console.log(`🚀 App running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Error starting the app:', err);
});
