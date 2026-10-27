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
  Req,
  ForbiddenException,
  ParseUUIDPipe,
  GoneException,
} from '@nestjs/common';
import { ScheduleService } from './schedules.service';
import { ScheduleBaseDto, CreateScheduleDto, UpdateScheduleDto } from './dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import { LoadScheduleDto } from './dto';
import { Weekday } from '../../generated/prisma/client';
import { Unauthenticated } from '@modules/auth/decorators/unauthenticated.decorator';
import { getCoordinatorCourseId } from '@modules/auth/utils/coordinator-role';
import type { AuthenticatedRequest } from '@modules/auth/authenticated-request';
import { ClearAvailabilityDto, SaveAvailabilityDto } from './dto/availability.dto';
import { AssignTeacherDto } from './dto/assign-teacher.dto';

@Controller('schedules')
@ApiTags('Schedules')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Post('teachers/availability/clear')
  @Authorization({ adminOnly: true, permission: 'schedule.availability.update', description: 'Quitar disponibilidad de docentes seleccionados' })
  clearAvailability(@Body() data: ClearAvailabilityDto) {
    return this.scheduleService.clearAvailability(data.teacherIds);
  }

  @Get('teachers/:teacherId/availability')
  @Authorization({ adminOnly: true, permission: 'schedule.availability.get', description: 'Consultar disponibilidad del docente' })
  getAvailability(@Param('teacherId', ParseUUIDPipe) teacherId: string) {
    return this.scheduleService.getAvailability(teacherId);
  }

  @Put('teachers/:teacherId/availability')
  @Authorization({ adminOnly: true, permission: 'schedule.availability.update', description: 'Guardar disponibilidad del docente' })
  saveAvailability(@Param('teacherId', ParseUUIDPipe) teacherId: string, @Body() data: SaveAvailabilityDto) {
    return this.scheduleService.saveAvailability(teacherId, data);
  }

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
  getPublicScheduleByTeacher(
    @Query('email') email: string,
    @Query('dni') dni: string,
  ) {
    void email; void dni;
    throw new GoneException('La consulta con DNI fue retirada. Inicia sesión para consultar tu horario.');
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
  findAll(@Req() req: AuthenticatedRequest): Promise<ScheduleBaseDto[]> {
    return this.scheduleService.findAll(getCoordinatorCourseId(req.user?.role));
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
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<ScheduleBaseDto> {
    return this.scheduleService.findOne(
      id,
      getCoordinatorCourseId(req.user?.role),
    );
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
    permission: 'schedule.assignTeacher',
    description: 'Asignar profesor a horarios',
  })
  @Patch('/asignar/profesor')
  async assignTeacherToSchedules(
    @Body() assignTeacherDto: AssignTeacherDto,
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
      throw new BadRequestException(error instanceof Error ? error.message : String(error));
    }
  }

  @Authorization({
    permission: 'schedule.unassignTeacher',
    description: 'Desasignar profesor de horarios',
  })
  @Patch('/desasignar/profesor')
  async unassignTeacherFromSchedules(
    @Body() unassignTeacherDto: AssignTeacherDto,
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
          teacherId,
        );

      return {
        message: 'Profesor desasignado correctamente',
        updatedSchedules,
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : String(error));
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
    @Query('teacher_id', ParseUUIDPipe) teacherId: string,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('pageSize', ParseIntPipe) pageSize: number = 10,
    @Query('area_id') areaId?: number,
    @Query('shift_id') shiftId?: number,
    @Req() req?: AuthenticatedRequest,
  ) {
    const coordinatorCourseId = getCoordinatorCourseId(req?.user?.role);
    if (coordinatorCourseId !== undefined && coordinatorCourseId !== courseId) {
      throw new ForbiddenException('Curso no autorizado');
    }

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
        teacherId,
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
