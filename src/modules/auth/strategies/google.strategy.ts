import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { AuthService } from '../auth.service';
import { AuthResponseDto } from '@modules/auth/dto/auth-google.dto';
import { ConfigService } from '@nestjs/config';
import { OAuthStateStore } from '../oauth-state.store';
import type { StateStore } from 'passport-oauth2';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private authService: AuthService,
    config: ConfigService,
    state: OAuthStateStore,
  ) {
    super({
      clientID: config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow<string>('GOOGLE_REDIRECT_URI'),
      scope: ['profile', 'email'],
      state: true,
      // Passport dispatches by arity: store(req, cb), verify(req, state, cb).
      store: state as unknown as StateStore,
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<any> {
    const authResponse: AuthResponseDto =
      await this.authService.validateGoogleUser(profile);
    return done(null, authResponse);
  }
}
