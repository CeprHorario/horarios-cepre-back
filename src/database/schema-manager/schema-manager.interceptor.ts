import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import { RequestContext } from './request-context';
import { SchemaManagerService } from './schema-manger.service';
import { SCHEMA_ROUTING_BYPASS_KEY } from './schema-routing-bypass.decorator';

@Injectable()
export class SchemaManagerInterceptor implements NestInterceptor {
  constructor(
    private readonly context: RequestContext,
    private readonly schemas: SchemaManagerService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    execution: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (
      this.reflector.getAllAndOverride<boolean>(SCHEMA_ROUTING_BYPASS_KEY, [
        execution.getHandler(),
        execution.getClass(),
      ])
    )
      return next.handle();
    const request = execution
      .switchToHttp()
      .getRequest<Request & { user?: { role?: string } }>();
    const state = this.context.require();
    const schema =
      request.user?.role === 'administrador'
        ? state.routing?.adminSchema
        : state.routing?.userSchema;
    if (!schema) throw new Error('Missing request routing');
    await this.schemas.assertAvailable(schema);
    state.schema = schema;
    // Subscription must run inside ALS too: next.handle() alone is lazy.
    return new Observable((subscriber) =>
      this.context.run(state, () => next.handle().subscribe(subscriber)),
    );
  }
}
