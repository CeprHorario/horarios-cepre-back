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
} from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { CreateMonitorDto, UpdateMonitorDto, MonitorInformationDto } from './dto';
import { ScheduleDto } from './dto/schedule.dto';
import { Authorization, Role } from '@modules/auth/decorators/authorization.decorator';
import { TeacherResponseDto } from './dto/teacher-response.dto';

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

  @Get()
  @Authorization({
    permission: 'monitor.list',
    description: 'Listar todos los monitores',
  })
  findAll() {
    return this.monitorService.findAll();
  }

  @Get(':id/')
  @Authorization({
    permission: 'monitor.getById',
    description: 'Obtener un monitor por ID',
  })
  findOne(@Param('id') id: string) {
    return this.monitorService.findOne(id);
  }

  @Put(':id')
  @Authorization({
    permission: 'monitor.update',
    description: 'Actualizar un monitor',
  })
  update(@Param('id') id: string, @Body() updateMonitorDto: UpdateMonitorDto) {
    return this.monitorService.update(id, updateMonitorDto);
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
    roles: [Role.MONITOR, Role.ADMIN],
    permission: 'monitor.listTeachersByMonitor',
    description: 'Cargar los docentes de un monitor',
  })
  async getTeachersByMonitor(@Req() req): Promise<TeacherResponseDto[]> {
    const userId = req.user?.userId; 
    return this.monitorService.getTeachersByMonitor(userId);
  }

  @Get('/:userId/teachers')
  @Authorization({
    roles: [Role.MONITOR, Role.SUPERVISOR, Role.ADMIN],
    permission: 'monitor.listTeachersByMonitor',
    description: 'Cargar los docentes de un monitor',
  })
  async getTeachersByMonitorParam(@Param('userId') userId: string): Promise<TeacherResponseDto[]>{
    if (!userId) {
      throw new UnauthorizedException('No se pudo obtener el ID del usuario');
    }
    return this.monitorService.getTeachersByMonitor(userId);
  }
}
