import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { OAuthStateStore } from '../oauth-state.store';

@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  constructor(private readonly state: OAuthStateStore) {
    super();
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    try {
      if (
        typeof request.query.code !== 'string' ||
        typeof request.query.state !== 'string' ||
        request.query.error
      )
        throw new Error();
      return (await super.canActivate(context)) as boolean;
    } catch {
      // Never forward provider errors: they may carry OAuth tokens or headers.
      request.user = {};
      return true;
    } finally {
      this.state.clear(context.switchToHttp().getResponse<Response>());
    }
  }
}
