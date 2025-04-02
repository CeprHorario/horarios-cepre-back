import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Put,
  Delete,
  Req,
} from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { CreateMonitorDto, UpdateMonitorDto } from './dto';
import { ScheduleDto } from './dto/schedule.dto';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';
import { TeacherResponseDto } from './dto/teacher-response.dto';
import { Unauthenticated } from '@modules/auth/decorators/unauthenticated.decorator';

@Controller('monitors')
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

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
    permission: 'monitor.loadSchedule',
    description: 'Cargar el horario de un monitor',
  })
  getSchedule(@Req() req): Promise<ScheduleDto[]> {
    console.log('Usuario autenticado:', req.user);
    const userId = req.user?.userId; 
    return this.monitorService.getSchedule(userId);
  }
  
  @Authorization({
    permission: 'monitor.listTeachersByMonitor',
    description: 'Cargar los docentes de un monitor',
  })
  @Get('teachers')
  async getTeachersByMonitor(@Req() req): Promise<TeacherResponseDto[]> {
    const userId = req.user?.id; // Obtener el userId del token
    return this.monitorService.getTeachersByMonitor(userId);
  }
}
