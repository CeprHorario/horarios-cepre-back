import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SyncAuthorizationService } from './sync-authorization.service';
import { Unauthenticated } from './decorators/unauthenticated.decorator';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { GoogleCallbackGuard } from './guards/google-auth.guard';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import { MaintenanceBypass } from '@modules/runtime-config/decorators/maintenance-bypass.decorator';
import { SchemaRoutingBypass } from '@database/schema-manager/schema-routing-bypass.decorator';
import type { Request, Response } from 'express';
@Controller('auth')
export class AuthController {
  constructor(
    private syncAuthorizationService: SyncAuthorizationService,
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  @Unauthenticated() // Evita que se aplique el guard de autorización
  @MaintenanceBypass()
  @Get('google')
  @SchemaRoutingBypass()
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // Redirige al usuario a la pantalla de autenticación de Google
  }

  @Unauthenticated()
  @MaintenanceBypass()
  @Get('google/redirect')
  @SchemaRoutingBypass()
  @UseGuards(GoogleCallbackGuard)
  googleAuthRedirect(
    @Req() req: Request & { user?: { token?: string } },
    @Res() res: Response,
  ) {
    const payload = req.user?.token
      ? { token: req.user.token }
      : { error: 'error_authenticating' };
    const json = (value: unknown) =>
      JSON.stringify(value).replace(/</g, '\\u003c');
    const origin = new URL(this.config.getOrThrow<string>('REDIRECT_FRONT'))
      .origin;
    const nonce = randomBytes(16).toString('base64');
    res.set({
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    });
    res.type('html')
      .send(`<!doctype html><html><body><p>Puedes cerrar esta ventana.</p><script nonce="${nonce}">
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(${json(payload)}, ${json(origin)});
        window.close();
      }
    </script></body></html>`);
  }

  @Authorization({
    roles: [Role.SUPERVISOR, Role.MONITOR, Role.TEACHER, Role.ADMIN],
    permission: 'auth.userInfo',
    description: 'Obtiene la información del usuario autenticado',
  })
  @Get('user-info')
  @SchemaRoutingBypass()
  getUserInfo(@Req() request: Request & { user: AuthenticatedUser }) {
    return this.authService.getUserInfo(request.user);
  }

  @Authorization({
    roles: [Role.ADMIN],
    permission: 'auth.sync-authorizations',
    adminOnly: true,
    description: 'Sincronizar permisos de endpoints',
  })
  @Post('sync-authorizations')
  @SchemaRoutingBypass()
  syncAuthorizations(): any {
    return this.syncAuthorizationService.syncAuthorization();
  }
}
