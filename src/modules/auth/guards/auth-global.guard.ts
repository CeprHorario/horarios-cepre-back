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

@Injectable()
export class AuthGlobalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly authorizationGuard: AuthorizationGuard,
    private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bypassMaintenance = this.reflector.getAllAndOverride<boolean>(
      MAINTENANCE_BYPASS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (bypassMaintenance) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      await this.assertMaintenanceAccess(context);
      return true;
    }

    const jwtCanActivate = await this.jwtAuthGuard.canActivate(context);
    if (!jwtCanActivate) return false;

    await this.assertMaintenanceAccess(context);
    return this.authorizationGuard.canActivate(context);
  }

  private async assertMaintenanceAccess(
    context: ExecutionContext,
  ): Promise<void> {
    const config = await this.runtimeConfig.getCurrent();
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
