import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SyncAuthorizationService } from './sync-authorization.service';
import { Unauthenticated } from './decorators/unauthenticated.decorator';
import { AuthService } from './auth.service';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
@Controller('auth')
export class AuthController {
  constructor(
    private syncAuthorizationService: SyncAuthorizationService,
    private authService: AuthService,
  ) {}

  @Unauthenticated() // Evita que se aplique el guard de autorización
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // Redirige al usuario a la pantalla de autenticación de Google
  }

  @Unauthenticated()
  @Get('google/redirect')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res() res) {
    try {
      const token =
        req.user?.token ||
        (() => {
          throw new Error();
        })();
      console.log(token);
      res.send(`
        <script>
          window.opener.postMessage(${JSON.stringify({ token })}, "*");
          window.close();
        </script>
      `);
    } catch {
      res.send(`
        <script>
          window.opener.postMessage(${JSON.stringify({
            error: 'error_authenticating',
          })}, "*");
          window.close();
        </script>
      `);
    }
  }

  @Authorization({
    roles: [Role.SUPERVISOR, Role.MONITOR, Role.ADMIN],
    permission: 'supervisor.monitors',
    description: 'Obtiene los monitores de este supervisor',
  })
  @Get('user-info')
  async getUserInfo(@Headers('authorization') authHeader: string) {
    if (!authHeader) {
      throw new UnauthorizedException('Token no proporcionado');
    }

    const token = authHeader.replace('Bearer ', '');
    return this.authService.getUserInfoFromToken(token);
  }

  @Unauthenticated() // Evita que se aplique el guard de autorización
  @Post('sync-authorizations')
  syncAuthorizations(): any {
    return this.syncAuthorizationService.syncAuthorization();
  }
}
