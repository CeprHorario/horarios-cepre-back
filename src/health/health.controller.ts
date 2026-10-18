import { Controller, Get, SetMetadata } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Unauthenticated } from '@modules/auth/decorators/unauthenticated.decorator';
import { MaintenanceBypass } from '@modules/runtime-config/decorators/maintenance-bypass.decorator';
import { SchemaRoutingBypass } from '@database/schema-manager/schema-routing-bypass.decorator';

@ApiTags('Health')
@Controller('health')
@Unauthenticated()
@MaintenanceBypass()
@SchemaRoutingBypass()
@SetMetadata('runtimeConfigBypass', true)
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Comprobar que el backend está en ejecución' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { status: { type: 'string', example: 'ok' } },
      required: ['status'],
    },
  })
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
