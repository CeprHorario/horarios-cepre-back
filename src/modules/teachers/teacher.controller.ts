import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Put,
  Delete,
  Query,
  Patch,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TeacherService } from './teacher.service';
import { CreateTeacherWithUserDto } from './dto/create-teacher.dto';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';

import { CreateTeacherDto } from './dto/import-teacher.dto';
import { TeacherGetSummaryDto } from './dto/teacher-get-summary.dto';
import { TeacherUpdateDto } from './dto/teacher-update.dto';

import {
  ApiBody,
  ApiOperation,
  ApiTags,
  ApiQuery,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { TeacherGetByIdDto } from './dto/teacher-get-by-id.dto';
import { ScheduleTeacherDto } from './dto/schedule-teacher.dto';
import { TeacherFilteredDto } from '@modules/teachers/dto/teacherFiltered.dto';

@ApiTags('Teachers')
@Controller('teachers')
export class TeacherController {
  constructor(private readonly teacherService: TeacherService) {}

  @Post('available')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'teacher.available',
    description: 'Obtener profesores disponibles para un curso y horarios',
  })
  async getFilteredTeachers(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Body() data: TeacherFilteredDto,
  ): Promise<{
    data: TeacherGetSummaryDto[];
    page: number;
    limit: number;
  }> {
    return await this.teacherService.getFilteredTeachers(data, page, limit);
  }

  @Post()
  @Authorization({
    permission: 'teacher.create',
    description: 'Crear un nuevo profesor',
  })
  @ApiOperation({ summary: 'Crear un nuevo profesor' })
  async create(@Body() createTeacherDto: CreateTeacherWithUserDto) {
    return this.teacherService.createTeacher(createTeacherDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los profesores activos' })
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
    description: 'Lista de profesores paginada',
    type: TeacherGetSummaryDto,
    isArray: true,
  })
  @Authorization({
    permission: 'teacher.list',
    description: 'Obtiene todos los profesores',
  })
  findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('course_id') courseId?: number,
  ): Promise<{
    data: TeacherGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.teacherService.findAll(Number(page), Number(limit), Number(courseId));
  }

  @Get('search')
  @ApiOperation({ summary: 'Buscar profesores por nombre, apellido o correo' })
  @ApiQuery({
    name: 'query',
    type: String,
    required: true,
    description: 'Texto de búsqueda (nombre, apellido o correo)',
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
    description: 'Lista de profesores que coinciden con la búsqueda',
    type: TeacherGetSummaryDto,
    isArray: true,
  })
  @Authorization({
    permission: 'teacher.search',
    description: 'Buscar profesores',
  })
  search(
    @Query('query') query: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ): Promise<{
    data: TeacherGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.teacherService.search(query, Number(page), Number(limit));
  }

  @Get(':id')
  @Authorization({
    permission: 'teacher.getById',
    description: 'Obtener un profesor por su id',
  })
  @ApiOperation({ summary: 'Obtener un profesor por su ID' })
  @ApiParam({ name: 'id', type: String, description: 'ID del profesor' })
  @ApiResponse({
    status: 200,
    description: 'Detalles de un profesor',
    type: TeacherGetByIdDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Profesor no encontrado',
  })
  async findOne(@Param('id') id: string): Promise<TeacherGetByIdDto> {
    const teacher = await this.teacherService.findOne(id);
    if (!teacher) {
      throw new NotFoundException(`Profesor con ID ${id} no encontrado`);
    }
    return teacher;
  }

  @Put(':id')
  @Authorization({
    permission: 'teacher.update',
    description: 'Actualizar un profesor por su id',
  })
  @ApiOperation({ summary: 'Actualizar un profesor por su ID' })
  @ApiParam({ name: 'id', type: String, description: 'ID del profesor' })
  @ApiBody({
    description: 'Datos para actualizar un profesor',
    type: TeacherUpdateDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles del profesor actualizado',
    type: TeacherGetSummaryDto,
  })
  update(@Param('id') id: string, @Body() updateTeacherDto: TeacherUpdateDto) {
    return this.teacherService.update(id, updateTeacherDto);
  }

  @Delete(':id')
  @Authorization({
    permission: 'teacher.delete',
    description: 'Eliminar un profesor por su id',
  })
  delete(@Param('id') id: string) {
    return this.teacherService.delete(id);
  }

  @Post('json')
  @Authorization({
    permission: 'teacher.importjson',
    description: 'Crear profesores desde un archivo JSON',
  })
  @ApiOperation({
    summary: 'Crear profesores desde un archivo JSON',
  })

  @ApiBody({ type: [CreateTeacherDto] })
  async createTeachersFromJson(@Body() importTeacherDto: CreateTeacherDto[]) {
    return this.teacherService.createManyTeachers(importTeacherDto);
  }
  
  @Patch(':id/deactivate')
  @Authorization({
    permission: 'teacher.deactivate',
    description: 'Desactivar un teacher por su id',
  })
  async deactivateTeacher(@Param('id') id: string) {
    return this.teacherService.deactivate(id);
  }

  @Get(':teacherId/schedules')
  @ApiOperation({
    summary: 'Obtener los horarios y aulas donde enseña un profesor',
  })
  @ApiParam({
    name: 'teacherId',
    type: 'string',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de aulas y horarios',
    type: [ScheduleTeacherDto],
  })
  @Authorization({
    permission: 'teacher.getSchedules',
    description: 'Obtener los horarios y aulas donde enseña un profesor',
  })
  async getTeacherSchedules(
    @Param('teacherId') teacherId: string,
  ): Promise<ScheduleTeacherDto[]> {
    return this.teacherService.getTeacherSchedules(teacherId);
  }

  @Get('by-course/:courseId')
  @ApiOperation({ summary: 'Obtener profesores por curso' })
  @ApiParam({ name: 'courseId', type: String, description: 'ID del curso' })
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
  @Authorization({
    permission: 'teacher.listByCourse',
    description: 'Listar profesores por curso',
  })
  findByCourse(
    @Param('courseId') courseId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.teacherService.findByCourse(
      courseId,
      Number(page),
      Number(limit),
    );
  }

  /*
  @Get(':teacherId/schedules')
  @ApiOperation({
    summary: 'Obtener los horarios y aulas donde enseña un profesor',
  })
  @ApiParam({
    name: 'teacherId',
    type: 'string',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de aulas y horarios',
    type: [Object],
  })
  async getTeacherSchedules(@Param('teacherId') teacherId: string) {
    return this.teacherService.getTeacherSchedules(teacherId);
  }
  */
}
