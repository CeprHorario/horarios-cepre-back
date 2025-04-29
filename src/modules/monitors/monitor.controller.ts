import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Put,
  Delete,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Query,
  Patch,
  ParseBoolPipe,
} from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { CreateMonitorDto, MonitorInformationDto } from './dto';
import { ScheduleDto } from './dto/schedule.dto';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import { TeacherResponseDto } from './dto/teacher-response.dto';
import { UpdateMonitorAsAdminDto } from './dto/updateMonitorAsAdmin.dto';
import { MonitorGetSummaryDto } from './dto/monitor-get-summary.dto';
import { ApiResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MonitorWithoutSupervisorDto } from './dto/monitorWithoutSupervisor.dto';

@Controller('monitors')
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  @Get('information')
  @Authorization({
    roles: [Role.MONITOR],
    permission: 'monitor.getInformation',
    description: 'Obtener información del monitor autenticado',
  })
  @HttpCode(HttpStatus.OK)
  getInformation(@Req() req): Promise<MonitorInformationDto> {
    if (!req.user || req?.user.role !== Role.MONITOR) {
      throw new UnauthorizedException('No eres moni');
    }
    return this.monitorService.getInformationByMonitor(req.user.userId);
  }

  @Post()
  @Authorization({
    permission: 'monitor.create',
    description: 'Crear un nuevo monitor',
  })
  create(@Body() createMonitorDto: CreateMonitorDto) {
    return this.monitorService.create(createMonitorDto);
  }

  @Get('filtered')
  @Authorization({
    permission: 'monitor.list',
    description: 'Obtener todos los monitores activos',
  })
  @ApiOperation({ summary: 'Obtener todos los monitores activos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de monitores paginada',
    type: MonitorWithoutSupervisorDto,
    isArray: true,
  })
  findAllWithSupervisor(
    @Query('has_supervisor', new ParseBoolPipe()) hasSupervisor: boolean,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('shiftId') shiftId?: number,
  ): Promise<{
    data: MonitorWithoutSupervisorDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.monitorService.findAllWithSupervisor(
      hasSupervisor,
      shiftId,
      page,
      limit,
    );
  }

  @Get()
  @Authorization({
    permission: 'monitor.list',
    description: 'Obtener un monitor por ID',
  })
  @ApiOperation({ summary: 'Obtener todos los monitores activos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de monitores paginada',
    type: MonitorGetSummaryDto,
    isArray: true,
  })
  findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('shift_id') shiftId?: number,
    @Query('area_id') areaId?: number,
  ): Promise<{
    data: MonitorGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {

    return this.monitorService.findAllBasicInfo(Number(page), Number(limit), 
    areaId !== undefined ? Number(areaId) : undefined,
    shiftId !== undefined ? Number(shiftId) : undefined,
    );
  }

  @Get('search')
  @Authorization({
    permission: 'monitor.search',
    description:
      'Buscar monitores por nombre, apellido, email, teléfono o aula',
  })
  @ApiOperation({
    summary: 'Buscar monitores por nombre, apellido, email, teléfono o aula',
  })
  @ApiQuery({
    name: 'query',
    type: String,
    required: true,
    description: 'Texto de búsqueda (nombre, apellido, email, teléfono o aula)',
  })
  @ApiQuery({
    name: 'page',
    type: Number,
    required: false,
    description: 'Número de página',
  })
  @ApiQuery({
    name: 'limit',
    type: Number,
    required: false,
    description: 'Cantidad de resultados por página',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de monitores que coinciden con la búsqueda',
    type: MonitorGetSummaryDto,
    isArray: true,
  })
  search(
    @Query('query') query: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ): Promise<{
    data: MonitorGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.monitorService.search(query, Number(page), Number(limit));
  }

  @Get(':id/')
  @Authorization({
    permission: 'monitor.getById',
    description: 'Obtener un monitor por ID',
  })
  findOne(@Param('id') id: string) {
    return this.monitorService.findOne(id);
  }

  @Put('/:id')
  @Authorization({
    roles: [Role.MONITOR, Role.SUPERVISOR, Role.ADMIN],
    permission: 'monitor.updateAsAdmin',
    description: 'Actualizar datos de un monitor como administrador',
  })
  async updateMonitorAsAdmin(
    @Param('id') id: string,
    @Body() updateMonitorDto: UpdateMonitorAsAdminDto,
  ) {
    return this.monitorService.updateMonitorAsAdmin(id, updateMonitorDto);
  }

  @Delete(':id')
  @Authorization({
    permission: 'monitor.delete',
    description: 'Eliminar un monitor',
  })
  delete(@Param('id') id: string) {
    return this.monitorService.delete(id);
  }

  @Get('/cargar/horario')
  @Authorization({
    roles: [Role.MONITOR, Role.ADMIN],
    permission: 'monitor.loadSchedule',
    description: 'Cargar el horario de un monitor',
  })
  getSchedule(@Req() req): Promise<ScheduleDto[]> {
    console.log('Usuario autenticado:', req.user);
    const userId = req.user?.userId;
    return this.monitorService.getSchedule(userId);
  }

  @Get('/:userId/horario')
  @Authorization({
    roles: [Role.MONITOR, Role.SUPERVISOR, Role.ADMIN],
    permission: 'monitor.listTeachersByMonitor',
    description: 'Cargar los docentes de un monitor',
  })
  getScheduleByParam(@Param('userId') userId: string): Promise<ScheduleDto[]> {
    if (!userId) {
      throw new UnauthorizedException('No se pudo obtener el ID del usuario');
    }
    return this.monitorService.getSchedule(userId);
  }

  @Get('/datos/teachers')
  @Authorization({
    roles: [Role.MONITOR, Role.ADMIN, Role.SUPERVISOR],
    permission: 'monitor.listTeachersByMonitor',
    description: 'Cargar los docentes de un monitor',
  })
  async getTeachersByMonitor(@Req() req): Promise<TeacherResponseDto[]> {
    console.log('Usuario autenticado:', req.user);
    const userId = req.user?.userId;
    return this.monitorService.getTeachersByMonitor(userId);
  }

  @Get('/:userId/teachers')
  @Authorization({
    roles: [Role.MONITOR, Role.SUPERVISOR, Role.ADMIN],
    permission: 'monitor.listTeachersByMonitor',
    description: 'Cargar los docentes de un monitor',
  })
  async getTeachersByMonitorParam(
    @Param('userId') userId: string,
  ): Promise<TeacherResponseDto[]> {
    if (!userId) {
      throw new UnauthorizedException('No se pudo obtener el ID del usuario');
    }
    return this.monitorService.getTeachersByMonitor(userId);
  }

  @Patch(':id/deactivate')
  @Authorization({
    permission: 'monitor.deactivate',
    description: 'Desactivar un monitor por su id',
  })
  async deactivateMonitor(@Param('id') id: string) {
    return this.monitorService.deactivate(id);
  }
}
