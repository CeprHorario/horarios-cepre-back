import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SyncAuthorizationService } from './sync-authorization.service';
import { Unauthenticated } from './decorators/unauthenticated.decorator';
//import { AuthResponseDto } from '@modules/auth/dto/auth-google.dto';

@Controller('auth')
export class AuthController {
  constructor(private syncAuthorizationService: SyncAuthorizationService) {}

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
      console.log('Google Auth Redirect:', req.user.token); // Debugging
      const token = req.user?.token || (() => { throw new Error(); })();

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
            error: 'error_authenticating'
          })}, "*");
          window.close();
        </script>
      `);
    }
  }

  @Unauthenticated() // Evita que se aplique el guard de autorización
  @Post('sync-authorizations')
  syncAuthorizations(): any {
    return this.syncAuthorizationService.syncAuthorization();
  }
}
