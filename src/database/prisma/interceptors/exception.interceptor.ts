import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler,
  NotFoundException, ConflictException, BadRequestException,
  InternalServerErrorException, HttpException,
} from '@nestjs/common';
import { Observable, catchError } from 'rxjs';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { RequestContext } from '../../schema-manager/request-context';

@Injectable()
export class PrismaExceptionInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService, private readonly context: RequestContext) {}

  // Prisma 7 pg reports the index; v0 exposed SQL columns, including compound keys.
  private async uniqueColumns(index?: string): Promise<string | undefined> {
    if (!index) return undefined;
    const schema = this.context.require().schema;
    const columns = await this.prisma.getClient().$queryRaw<{ name: string }[]>`
      SELECT a.attname AS name
      FROM pg_catalog.pg_class i
      JOIN pg_catalog.pg_namespace n ON n.oid = i.relnamespace
      JOIN pg_catalog.pg_index x ON x.indexrelid = i.oid
      CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, position)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
      WHERE n.nspname = ${schema} AND i.relname = ${index}
      ORDER BY k.position
    `;
    return columns.map((column) => column.name).join(', ') || index;
  }
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError(async (error: unknown) => {
      if (error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const modelName = typeof error.meta?.modelName === 'string' ? error.meta.modelName : 'Record';
        const adapterError = error.meta?.driverAdapterError as {
          cause?: { constraint?: { fields?: string[]; index?: string } };
        } | undefined;
        const constraint = adapterError?.cause?.constraint;
        switch (error.code) {
          case 'P2022':
          case 'P2025':
            throw new NotFoundException(`${modelName} not found`);
          case 'P2002': {
            const target = Array.isArray(error.meta?.target)
              ? error.meta.target.join(', ') : typeof error.meta?.target === 'string' ? error.meta.target : constraint?.fields?.join(', ') || await this.uniqueColumns(constraint?.index) || 'field';
            throw new ConflictException(`The value for '${target}' already exists.`);
          }
          case 'P2003':
            throw new BadRequestException(`Related ${typeof error.meta?.field_name === 'string' ? error.meta.field_name : constraint?.index ? `${constraint.index} (index)` : 'field'} not found or invalid`);
          default:
            throw new InternalServerErrorException('Database error occurred, please contact an administrator.');
        }
      }
      throw new InternalServerErrorException('An unexpected error occurred, please contact an administrator.');
    }));
  }
}
