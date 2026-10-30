import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContext } from '@database/schema-manager/request-context';
import {
  AUTHORIZATION_METADATA_KEY,
  AuthorizationMetadata,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import type { SessionPrincipal } from './session.types';

@Injectable()
export class ClassSessionContextGuard implements CanActivate {
  constructor(
    private readonly context: RequestContext,
    private readonly reflector: Reflector,
  ) {}

  canActivate(execution: ExecutionContext): boolean {
    const metadata = this.reflector.get<AuthorizationMetadata>(
      AUTHORIZATION_METADATA_KEY,
      execution.getHandler(),
    );
    if (metadata?.permission === 'class-session-records.context') return true;
    const request = execution
      .switchToHttp()
      .getRequest<Request & { user: SessionPrincipal }>();
    const expected = request.headers['x-class-session-context'];
    const expectedAccount = request.headers['x-class-session-account'];
    const { routing } = this.context.require();
    const selected =
      request.user.role === String(Role.ADMIN)
        ? routing?.adminSchema
        : routing?.userSchema;
    // Preconditions only: neither header selects a client or an authenticated actor.
    if (
      (expected !== undefined && expected !== selected) ||
      (expectedAccount !== undefined && expectedAccount !== request.user.userId)
    )
      throw new ConflictException({
        code: 'CLASS_SESSION_CONTEXT_CHANGED',
        message:
          'La cuenta o el proceso operativo cambió; actualice el contexto antes de continuar',
      });
    return true;
  }
}
