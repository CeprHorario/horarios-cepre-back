import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AsyncLocalStorage } from 'async_hooks';
import { SchemaManagerService } from './schema-manger.service';
@Injectable()
export class SchemaManagerInterceptor implements NestInterceptor {
  constructor(
    private readonly schemaManager: SchemaManagerService,
    private readonly als: AsyncLocalStorage<{ schema: string }>,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    // Get the request object
    const request = context.switchToHttp().getRequest();
    const schema = request.headers['x-schema'] as string;

    if (schema) {
      // Verificamos si el esquema existe en nuestra base de datos
      const schemaExists = await this.schemaManager.schemaExists(schema);
      if (!schemaExists) throw new UnauthorizedException('Invalid header');
      return this.als.run({ schema }, () => next.handle());
    }

    // Guardamos el schema en el contexto async
    return this.als.run({ schema: 'default' }, () => next.handle());
  }
}
