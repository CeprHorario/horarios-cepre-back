import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { ScheduleService } from './schedules.service';
import { ScheduleBaseDto, CreateScheduleDto, UpdateScheduleDto } from './dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';
import { LoadScheduleDto } from './dto';

@Controller('schedules')
@ApiTags('Schedules')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Post('load-with-courses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cargar horarios con cursos',
    description: 'Load schedules with courses',
  })
  @Authorization({
    permission: 'schedule.loadWithCourses',
    description: 'Cargar horarios con cursos',
  })
  loadWithCourses(@Body() data: LoadScheduleDto) {
    return this.scheduleService.loadWithCourses(data);
  }

  // ─────── CRUD ───────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authorization({
    permission: 'schedule.create',
    description: 'Crear un nuevo horario',
  })
  @ApiOperation({
    summary: 'Crear un nuevo horario',
    description: 'Create a new schedule',
  })
  create(
    @Body() createScheduleDto: CreateScheduleDto,
  ): Promise<ScheduleBaseDto> {
    return this.scheduleService.create(createScheduleDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'schedule.list',
    description: 'Listar todos los horarios',
  })
  @ApiOperation({
    summary: 'Obtener todos los horarios',
    description: 'Get all schedules',
  })
  findAll(): Promise<ScheduleBaseDto[]> {
    return this.scheduleService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'schedule.getById',
    description: 'Obtener un horario por id',
  })
  @ApiOperation({
    summary: 'Obtener un horario por id',
    description: 'Get a schedule by id',
  })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<ScheduleBaseDto> {
    return this.scheduleService.findOne(id);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'schedule.update',
    description: 'Actualizar un horario por id',
  })
  @ApiOperation({
    summary: 'Actualizar un horario por id',
    description: 'Update a schedule by id',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() UpdateScheduleDto: UpdateScheduleDto,
  ): Promise<ScheduleBaseDto> {
    return this.scheduleService.update(id, UpdateScheduleDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authorization({
    permission: 'schedule.delete',
    description: 'Eliminar un horario por id',
  })
  @ApiOperation({
    summary: 'Eliminar un horario por id',
    description: 'Delete a schedule by id',
  })
  delete(@Param('id', ParseIntPipe) id: number): Promise<ScheduleBaseDto> {
    return this.scheduleService.delete(id);
  }
}
