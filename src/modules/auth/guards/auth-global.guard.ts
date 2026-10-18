import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RuntimeConfigService } from '@modules/runtime-config/runtime-config.service';
import { MAINTENANCE_BYPASS_KEY } from '@modules/runtime-config/decorators/maintenance-bypass.decorator';
import { AuthorizationGuard } from './authorization.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Role } from '../decorators/authorization.decorator';
import { IS_PUBLIC_KEY } from '../decorators/unauthenticated.decorator';
import { RequestContext } from '@database/schema-manager/request-context';
import { SchemaManagerService } from '@database/schema-manager/schema-manger.service';
import { SCHEMA_ROUTING_BYPASS_KEY } from '@database/schema-manager/schema-routing-bypass.decorator';

@Injectable()
export class AuthGlobalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly authorizationGuard: AuthorizationGuard,
    private readonly runtimeConfig: RuntimeConfigService,
    private readonly requestContext: RequestContext,
    private readonly schemas: SchemaManagerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bypassMaintenance = this.reflector.getAllAndOverride<boolean>(
      MAINTENANCE_BYPASS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const bypassRouting = this.reflector.getAllAndOverride<boolean>(
      SCHEMA_ROUTING_BYPASS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      isPublic &&
      bypassMaintenance &&
      bypassRouting &&
      this.reflector.getAllAndOverride<boolean>('runtimeConfigBypass', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const state = this.requestContext.require();
    state.runtime = await this.runtimeConfig.getCurrent();
    state.routing =
      state.runtime?.schemaRouting ??
      (await this.schemas
        .getCurrent()
        .then(({ name }) => ({ adminSchema: name, userSchema: name })));
    if (isPublic) {
      if (!bypassMaintenance) this.assertMaintenanceAccess(context);
      return true;
    }

    const jwtCanActivate = await this.jwtAuthGuard.canActivate(context);
    if (!jwtCanActivate) return false;

    if (!bypassMaintenance) this.assertMaintenanceAccess(context);
    return this.authorizationGuard.canActivate(context);
  }

  private assertMaintenanceAccess(context: ExecutionContext): void {
    const config = this.requestContext.require().runtime;
    if (!config?.maintenance.enabled) return;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { role?: string } }>();
    if (request.user?.role === Role.ADMIN) return;

    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', '60');
    throw new ServiceUnavailableException({
      code: 'MAINTENANCE_MODE',
      message: config.maintenance.message,
      endsAt: config.maintenance.endsAt,
    });
  }
}
