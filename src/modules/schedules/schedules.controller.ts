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
  Patch,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { ScheduleService } from './schedules.service';
import { ScheduleBaseDto, CreateScheduleDto, UpdateScheduleDto } from './dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import { LoadScheduleDto } from './dto';
import { Weekday } from '@prisma/client';
import { Unauthenticated } from '@modules/auth/decorators/unauthenticated.decorator';

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
  loadWithCourses(data: LoadScheduleDto) {
    return this.scheduleService.loadWithCourses(data);
  }

  @Get('public/teachers')
  @HttpCode(HttpStatus.OK)
  @Unauthenticated()
  @ApiOperation({
    summary: 'Obtener horarios públicos por profesor',
    description: 'Get public schedules by teacher',
  })
  async getPublicScheduleByTeacher(
    @Query('email') email: string,
    @Query('dni') dni: string,
  ) {
    return await this.scheduleService.getPublicScheduleByTeacher(email, dni);
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

  @Authorization({
    permission: 'schedule.delete',
    description: 'Eliminar un horario por id',
  })
  @Patch('/asignar/profesor')
  async assignTeacherToSchedules(
    @Body() assignTeacherDto: { classroomIds: string[]; teacherId: string },
  ) {
    const { classroomIds, teacherId } = assignTeacherDto;

    if (!Array.isArray(classroomIds) || classroomIds.length === 0) {
      throw new BadRequestException(
        'Se deben proporcionar al menos un ID de salón.',
      );
    }

    try {
      const updatedSchedules =
        await this.scheduleService.assignTeacherToSchedules(
          classroomIds,
          teacherId,
        );

      return {
        message: 'Profesor asignado correctamente a los horarios',
        updatedSchedules,
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Authorization({
    permission: 'schedule.delete',
    description: 'Desasignar profesor de horarios',
  })
  @Patch('/desasignar/profesor')
  async unassignTeacherFromSchedules(
    @Body() unassignTeacherDto: { classroomIds: string[]; teacherId: string },
  ) {
    const { classroomIds, teacherId } = unassignTeacherDto;

    if (!Array.isArray(classroomIds) || classroomIds.length === 0) {
      throw new BadRequestException(
        'Se deben proporcionar al menos un ID de salón.',
      );
    }

    if (!teacherId) {
      throw new BadRequestException(
        'Se debe proporcionar el ID del profesor a desasignar.',
      );
    }

    try {
      const updatedSchedules =
        await this.scheduleService.unassignTeacherFromSchedules(
          classroomIds,
          teacherId
        );

      return {
        message: 'Profesor desasignado correctamente',
        updatedSchedules,
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Authorization({
    roles: [Role.ADMIN],
    permission: 'schedule.getAvailableClassrooms',
    description: 'Obtener aulas disponibles',
  })
  @ApiOperation({
    summary: 'Obtener aulas disponibles',
    description: 'Get available classrooms',
  })
  @Get('/salones/disponibles')
  async getAvailableClassrooms(
    @Query('course_id', ParseIntPipe) courseId: number,
    @Query('horario') horario: string,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('pageSize', ParseIntPipe) pageSize: number = 10,
    @Query('area_id') areaId?: number,
    @Query('shift_id') shiftId?: number,
  ) {
    try {
      const parsedHorario = JSON.parse(horario) as Array<{
        id_hour_session: number;
        weekday: Weekday;
      }>;

      if (!Array.isArray(parsedHorario)) {
        throw new BadRequestException('El horario debe ser un array');
      }

      return this.scheduleService.findAvailableClassrooms(
        courseId,
        parsedHorario,
        page,
        pageSize,
        areaId ? Number(areaId) : undefined,
        shiftId ? Number(shiftId) : undefined,
      );
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new BadRequestException(
          'Formato de horario inválido. Debe ser un JSON válido',
        );
      }
      throw error;
    }
  }

}
