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

  @Unauthenticated() // Evita que se aplique el guard de autorización
  @Get('google/redirect')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res() res) {
    if (!req.user || !req.user.token) {
      return res.redirect(`${process.env.REDIRECT_FRONT}/login?error=authentication_failed`);
    }
    res.redirect(`${process.env.REDIRECT_FRONT}/login?token=${req.user.token}`);
  }

  @Unauthenticated() // Evita que se aplique el guard de autorización
  @Post('sync-authorizations')
  syncAuthorizations(): any {
    return this.syncAuthorizationService.syncAuthorization();
  }
}
