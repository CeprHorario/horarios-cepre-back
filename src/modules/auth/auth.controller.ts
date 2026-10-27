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
import {
  clearSessionCookie,
  setSessionCookie,
  sessionCookieToken,
} from './session-cookie';
import { TokenRevocationService } from './token-revocation.service';
import type { AuthenticatedRequest } from './authenticated-request';
@Controller('auth')
export class AuthController {
  constructor(
    private syncAuthorizationService: SyncAuthorizationService,
    private authService: AuthService,
    private config: ConfigService,
    private revocations: TokenRevocationService,
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
    if (req.user?.token)
      setSessionCookie(
        res,
        req.user.token,
        this.config.get<string>('NODE_ENV') === 'production',
        this.config.getOrThrow<number>('JWT_EXPIRES_IN'),
        this.config.get<'lax' | 'none'>('SESSION_SAME_SITE', 'lax'),
      );
    const payload = req.user?.token
      ? { authenticated: true }
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

  @Post('session')
  @SchemaRoutingBypass()
  @MaintenanceBypass()
  @Authorization({
    permission: 'auth.session',
    description: 'Establecer cookie de sesión desde una credencial válida',
  })
  establishSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (token)
      setSessionCookie(
        res,
        token,
        this.config.get<string>('NODE_ENV') === 'production',
        this.config.getOrThrow<number>('JWT_EXPIRES_IN'),
        this.config.get<'lax' | 'none'>('SESSION_SAME_SITE', 'lax'),
      );
    return { authenticated: true };
  }

  @Post('logout')
  @SchemaRoutingBypass()
  @MaintenanceBypass()
  @Authorization({
    permission: 'auth.logout',
    description: 'Cerrar sesión del navegador',
  })
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token =
      req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1] ??
      sessionCookieToken(req, this.config.get<string>('NODE_ENV') === 'production');
    if (token) await this.revocations.revoke(token, req.user.expiresAt);
    clearSessionCookie(
      res,
      this.config.get<string>('NODE_ENV') === 'production',
      this.config.get<'lax' | 'none'>('SESSION_SAME_SITE', 'lax'),
    );
    return { success: true };
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
