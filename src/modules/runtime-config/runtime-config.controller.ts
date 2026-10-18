import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  SetMetadata,
} from '@nestjs/common';
import { Request } from 'express';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import { Unauthenticated } from '@modules/auth/decorators/unauthenticated.decorator';
import { SchemaManagerService } from '@database/schema-manager/schema-manger.service';
import { SchemaRoutingBypass } from '@database/schema-manager/schema-routing-bypass.decorator';
import { MaintenanceBypass } from './decorators/maintenance-bypass.decorator';
import { UpdateRuntimeConfigDto } from './dto/update-runtime-config.dto';
import { RuntimeConfigService } from './runtime-config.service';

@Controller('system')
@SchemaRoutingBypass()
export class RuntimeConfigController {
  constructor(
    private readonly runtimeConfig: RuntimeConfigService,
    private readonly schemaManager: SchemaManagerService,
  ) {}

  @Get('status')
  @SetMetadata('runtimeConfigBypass', true)
  @Unauthenticated()
  @MaintenanceBypass()
  @SchemaRoutingBypass()
  async getStatus() {
    const config = await this.runtimeConfig.getCurrent();
    return {
      maintenance: config?.maintenance.enabled ?? false,
      message:
        config?.maintenance.message ??
        'El sistema se encuentra temporalmente en mantenimiento',
      endsAt: config?.maintenance.endsAt ?? null,
    };
  }

  @Get('runtime-config')
  @Authorization({
    roles: [Role.ADMIN],
    permission: 'system.runtime-config.read',
    description: 'Obtener la configuración operativa',
  })
  async getRuntimeConfig() {
    const config = await this.runtimeConfig.getCurrent(true);
    if (!config) {
      throw new NotFoundException(
        'No existe la configuración system_config/runtime en Firestore',
      );
    }
    return config;
  }

  @Patch('runtime-config')
  @Authorization({
    roles: [Role.ADMIN],
    permission: 'system.runtime-config.update',
    description: 'Actualizar la configuración operativa',
  })
  async updateRuntimeConfig(
    @Body() body: UpdateRuntimeConfigDto,
    @Req() req: Request & { user: { userId: string; email: string } },
  ) {
    await this.validateSchemas(
      body.schemaRouting.adminSchema,
      body.schemaRouting.userSchema,
    );

    return this.runtimeConfig.update(
      {
        expectedVersion: body.expectedVersion,
        maintenance: {
          enabled: body.maintenance.enabled,
          message: body.maintenance.message,
          endsAt: body.maintenance.endsAt ?? null,
        },
        schemaRouting: {
          adminSchema: body.schemaRouting.adminSchema,
          userSchema: body.schemaRouting.userSchema,
        },
        changeReason: body.changeReason,
      },
      { id: req.user.userId, email: req.user.email },
    );
  }

  @Get('runtime-config/history')
  @Authorization({
    roles: [Role.ADMIN],
    permission: 'system.runtime-config.history',
    description: 'Obtener el historial de configuración operativa',
  })
  async getHistory(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.runtimeConfig.getHistory(limit);
  }

  @Post('runtime-config/rollback/:version')
  @Authorization({
    roles: [Role.ADMIN],
    permission: 'system.runtime-config.rollback',
    description: 'Restaurar una configuración anterior',
  })
  async rollback(
    @Param('version', ParseIntPipe) version: number,
    @Req() req: Request & { user: { userId: string; email: string } },
  ) {
    return this.runtimeConfig.rollback(version, {
      id: req.user.userId,
      email: req.user.email,
    });
  }

  @Get('schemas')
  @Authorization({
    roles: [Role.ADMIN],
    permission: 'system.schemas.list',
    description: 'Listar schemas disponibles para enrutamiento',
  })
  async getSchemas() {
    return this.schemaManager.getAllWithCache();
  }

  private async validateSchemas(
    adminSchema: string,
    userSchema: string,
  ): Promise<void> {
    const [adminExists, userExists] = await Promise.all([
      this.schemaManager.schemaExists(adminSchema),
      this.schemaManager.schemaExists(userSchema),
    ]);

    if (!adminExists || !userExists) {
      throw new NotFoundException({
        code: 'INVALID_SCHEMA_ROUTING',
        message: 'Uno o más schemas seleccionados no existen',
      });
    }
  }
}
