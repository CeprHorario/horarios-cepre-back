import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { RequestContext } from '@database/schema-manager/request-context';

@Injectable()
export class OAuthStateStore {
  private readonly secure: boolean;
  private readonly cookie: string;
  constructor(
    config: ConfigService,
    private readonly jwt: JwtService,
    private readonly context: RequestContext,
  ) {
    this.secure = config.get<string>('NODE_ENV') === 'production';
    this.cookie = this.secure ? '__Host-cepr-oauth' : 'cepr-oauth';
  }

  clear(response: Response) {
    response.clearCookie(this.cookie, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
    });
  }

  store(
    request: Request,
    callback: (error: Error | null, state?: string) => void,
  ): void {
    // Ponytail: one pending login per browser; use per-flow cookies if parallel popups become necessary.
    const nonce = randomBytes(32).toString('base64url');
    const schema = this.context.require().routing!.userSchema;
    const value = this.jwt.sign(
      { nonce, schema },
      { expiresIn: '5m', audience: 'cepr-oauth-state' },
    );
    request.res!.cookie(this.cookie, value, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 300000,
    });
    request.res!.setHeader('Cache-Control', 'no-store');
    callback(null, nonce);
  }

  verify(
    request: Request,
    state: unknown,
    callback: (error: Error | null, valid: boolean, info?: object) => void,
  ): void {
    const cookies = (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${this.cookie}=`));
    this.clear(request.res!);
    try {
      if (cookies.length !== 1 || typeof state !== 'string') throw new Error();
      const signed = decodeURIComponent(
        cookies[0].slice(this.cookie.length + 1),
      );
      const payload = this.jwt.verify<{
        nonce: string;
        schema: string;
        exp: number;
      }>(signed, { audience: 'cepr-oauth-state' });
      if (
        !payload.exp ||
        payload.schema !== this.context.require().routing?.userSchema
      )
        throw new Error();
      const expected = Buffer.from(payload.nonce);
      const received = Buffer.from(state);
      callback(
        null,
        expected.length === received.length &&
          timingSafeEqual(expected, received),
      );
    } catch {
      callback(null, false, { message: 'Invalid OAuth state' });
    }
  }
}
