import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { RuntimeConfigService } from '@modules/runtime-config/runtime-config.service';
import { SchemaManagerService } from './schema-manger.service';
import { SCHEMA_ROUTING_BYPASS_KEY } from './schema-routing-bypass.decorator';

@Injectable()
export class SchemaManagerInterceptor implements NestInterceptor {
  constructor(
    private readonly schemaManager: SchemaManagerService,
    private readonly runtimeConfig: RuntimeConfigService,
    private readonly als: AsyncLocalStorage<{ schema: string }>,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const bypassSchemaRouting = this.reflector.getAllAndOverride<boolean>(
      SCHEMA_ROUTING_BYPASS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (bypassSchemaRouting) return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { role?: string } }>();

    if (request.headers['x-schema']) {
      throw new BadRequestException({
        code: 'CLIENT_SCHEMA_SELECTION_DISABLED',
        message: 'El schema no puede ser seleccionado por el cliente',
      });
    }

    const config = await this.runtimeConfig.getCurrent();
    const schema = config
      ? request.user?.role === Role.ADMIN
        ? config.schemaRouting.adminSchema
        : config.schemaRouting.userSchema
      : 'default';

    if (config && !(await this.schemaManager.schemaExists(schema))) {
      throw new ServiceUnavailableException({
        code: 'INVALID_SCHEMA_ROUTING',
        message: `El schema configurado "${schema}" no est\u00e1 disponible`,
      });
    }

    return this.als.run({ schema }, () => next.handle());
  }
}
