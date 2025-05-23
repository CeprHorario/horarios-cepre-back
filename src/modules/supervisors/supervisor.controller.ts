import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Put,
  Delete,
  UseGuards,
  Req,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Query,
  Patch
} from '@nestjs/common';
import { SupervisorService } from './supervisor.service';
import { UpdateSupervisorWithProfileDto } from './dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CreateSupervisorWithUserDto } from './dto/create-supervisor.dto';
import { MonitorForSupervisorDto } from '@modules/monitors/dto/monitorForSupervisor.dto';
import { SupervisorGetSummaryDto } from './dto/supervisor-get-summary.dto';
import { AssignMonitorDto } from './dto/assign-monitor.dto';

@Controller('supervisors')
@UseGuards(JwtAuthGuard)
export class SupervisorController {
  constructor(private readonly supervisorService: SupervisorService) {}

  @Post()
  @Authorization({
    permission: 'supervisor.create',
    description: 'Crear un nuevo supervisor',
  })
  async create(@Body() createSupervisorrDto: CreateSupervisorWithUserDto) {
    return this.supervisorService.createSupervisor(createSupervisorrDto);
  }

  @Get()
  @ApiResponse({
    status: 200,
    description: 'Lista de supervisores paginada',
    type: SupervisorGetSummaryDto,
    isArray: true,
  })
  @ApiOperation({ summary: 'Obtener todos los supervisores activos' })
  @Authorization({
    permission: 'supervisor.list',
    description: 'Obtiene los supervisores',
  })
  findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ): Promise<{
    data: SupervisorGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.supervisorService.findAll(Number(page), Number(limit));
  }

  @Get('getMonitors')
  @Authorization({
    roles: [Role.SUPERVISOR],
    permission: 'supervisor.getMonitors',
    description: 'Obtiene los monitores de este supervisor',
  })
  @ApiOperation({ summary: 'Obtener los monitores de este supervisor' })
  @ApiResponse({
    status: 200,
    description: 'Monitores obtenidos.',
    type: [MonitorForSupervisorDto],
  })
  @ApiResponse({ status: 404, description: 'Ta sin monitores.' })
  getMonitors(@Req() req) {
    console.log('Usuario autenticado:', req.user); // Debugging
    const user = req?.user; // Verifica que exista

    if (user.role !== Role.SUPERVISOR) {
      throw new BadRequestException('No eres un supervisor');
    }
    return this.supervisorService.getMonitors(user.userId);
  }

  @Get(':id')
  @Authorization({
    permission: 'supervisor.get',
    description: 'Obtener un supervisor por su ID',
  })
  findOne(@Param('id') id: string) {
    return this.supervisorService.findOne(id);
  }

  @Post(':id/updateProfile')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'supervisor.updateProfile',
    description: 'Actualizar el perfil de un supervisor',
  })
  updateProfile(
    @Param('id') id: string,
    @Body() data: UpdateSupervisorWithProfileDto,
  ) {
    return this.supervisorService.updateSupervisorWithProfile(id, data);
  }

  @Put(':id')
  @Authorization({
    permission: 'supervisor.update',
    description: 'Actualizar un supervisor',
  })
  update(
    @Param('id') id: string,
    @Body() updateSupervisorDto: UpdateSupervisorWithProfileDto,
  ) {
    return this.supervisorService.update(id, updateSupervisorDto);
  }

  @Delete(':id')
  @Authorization({
    permission: 'supervisor.delete',
    description: 'Eliminar un supervisor',
  })
  delete(@Param('id') id: string) {
    return this.supervisorService.delete(id);
  }

  @Patch(':id/deactivate')
  @Authorization({
    permission: 'supervisor.deactivate',
    description: 'Desactivar un supervisor por su id',
  })
  async deactivateSupervisor(@Param('id') id: string) {
    return this.supervisorService.deactivate(id);
  }

  @Patch('assignMonitor')
  @Authorization({
    permission: 'supervisor.assignMonitor',
    description: 'Asignar o desasignar un monitor a un supervisor',
  })
  @ApiOperation({ summary: 'Asignar o desasignar un monitor a un supervisor' })
  async assignMonitor(@Body() assignMonitorDto: AssignMonitorDto) {
    return this.supervisorService.assignMonitor(assignMonitorDto);
  }

  @Get(':id/monitors')
  @Authorization({
    roles: [Role.SUPERVISOR],
    permission: 'supervisor.monitors',
    description: 'Obtiene los monitores de este supervisor',
  })
  @ApiOperation({ summary: 'Obtener los monitores de este supervisor' })
  @ApiResponse({
    status: 200,
    description: 'Monitores obtenidos.',
    type: [MonitorForSupervisorDto],
  })
  @ApiResponse({ status: 404, description: 'Ta sin monitores.' })
  getSupervisorMonitors(@Param('id') id: string) {
    return this.supervisorService.getSupervisorMonitors(id);
  }
  
}
