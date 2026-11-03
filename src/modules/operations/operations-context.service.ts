import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { RequestContext } from '@database/schema-manager/request-context';
import { SchemaManagerService } from '@database/schema-manager/schema-manger.service';
import {
  SessionPrincipal,
  SessionActor,
} from '../class-session-records/session.types';
import { Role } from '../auth/decorators/authorization.decorator';
import { assertSchemaName } from '@database/schema-manager/schema-name';
@Injectable()
export class OperationsContext {
  constructor(
    readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly schemas: SchemaManagerService,
  ) {}
  async get(principal: SessionPrincipal) {
    const state = this.context.require();
    const schema =
      principal.role === String(Role.ADMIN)
        ? state.routing?.adminSchema
        : state.routing?.userSchema;
    if (
      !schema ||
      state.schema !== schema ||
      ['public', 'core_schema'].includes(schema)
    )
      throw new ForbiddenException('Selecciona un proceso académico');
    assertSchemaName(schema);
    await this.schemas.assertAvailable(schema);
    const origin =
      principal.role === String(Role.ADMIN) ? 'core_schema' : schema;
    const user = await this.prisma.getClientForSchema(origin).user.findUnique({
      where: { id: principal.userId },
      include: { userProfile: true },
    });
    if (
      !user?.isActive ||
      user.email !== principal.email ||
      user.role !== principal.role
    )
      throw new ForbiddenException('La cuenta o su rol cambió');
    return {
      client: this.prisma.getClientForSchema(schema),
      schema,
      user,
      actor: {
        id: user.id,
        email: user.email,
        role: user.role as Role,
        origin,
        schema,
      } satisfies SessionActor,
    };
  }
}
