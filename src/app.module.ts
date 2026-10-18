import {
  BadRequestException,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@database/database.module';
import { validateEnvironment } from './config/environment';
import { HealthController } from './health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { AdmissionsModule } from './modules/admissions/admissions.module';
import { ModulesModule } from './modules/modules.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaExceptionInterceptor } from './database/prisma/interceptors/exception.interceptor';
import {
  RequestContext,
  RequestContextModule,
} from './database/schema-manager/request-context';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    RequestContextModule,
    AuthModule,
    AdmissionsModule,
    ModulesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: PrismaExceptionInterceptor }],
})
export class AppModule implements NestModule {
  constructor(private readonly context: RequestContext) {}
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((request: Request, _response: Response, next: NextFunction) => {
        if ('x-schema' in request.headers)
          return next(
            new BadRequestException({
              code: 'CLIENT_SCHEMA_SELECTION_DISABLED',
              message: 'El schema no puede ser seleccionado por el cliente',
            }),
          );
        this.context.run({}, next);
      })
      .forRoutes('*');
  }
}
