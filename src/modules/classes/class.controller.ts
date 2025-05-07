import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  Req,
  BadRequestException,
  Patch,
} from '@nestjs/common';
import { ClassService } from './class.service';
//import { Prisma } from '@prisma/client';
import {
  UpdateClassDto,
  ClassBaseDto,
  ClassForTeacherDto,
} from './dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Authorization, Role } from '@modules/auth/decorators/authorization.decorator';
import { ScheduleForClass } from './dto/scheduleForClass.dto';
import { TeacherResponseDto } from '@modules/monitors/dto/teacher-response.dto';
import { CreateClassDataDto } from './dto/CreateClassData.dto';
\
@Controller('classes')
@ApiTags('Classes')
export class ClassController {
  constructor(private readonly classService: ClassService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authorization({
    permission: 'class.createwithSchedule',
    description: 'Crear una nueva clase con su respectivo horario',
  })
  @ApiOperation({
    summary: 'Crear una nueva clase con su respectivo horario',
    description: 'Create a new class with its respective schedule',
  })
  create(@Body() body: CreateClassDataDto): Promise<ClassBaseDto> {
    return this.classService.create(body);
  }

  @Get(':classId/schedules')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'class.getSchedulesByClassId',
    description: 'Obtener horarios de una clase por su ID',
  })
  @ApiOperation({
    summary: 'Obtener horarios de una clase por su ID',
    description: 'Get schedules of a class by its ID',
  })
  async getSchedulesByClassId(
    @Param('classId', ParseUUIDPipe) classId: string,
  ): Promise<ScheduleForClass[]> {
    return await this.classService.getSchedulesByClassId(classId);
  }

  @Get(':classId/teachers')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'class.getTeachersByClassId',
    description: 'Obtener docentes de una clase por su ID',
  })
  @ApiOperation({
    summary: 'Obtener docentes de una clase por su ID',
    description: 'Get teachers of a class by its ID',
  })
  async getTeachersByClassId(
    @Param('classId', ParseUUIDPipe) classId: string,
  ): Promise<TeacherResponseDto[]> {
    return await this.classService.getTeachersByClassId(classId);
  }

  // ─────── CRUD ───────

  @Get()
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'class.list',
    description: 'Obtener todas las clases',
  })
  @ApiOperation({
    summary: 'Obtener todas las clases',
    description: 'Get all classes',
  })
  findAll(): Promise<ClassBaseDto[]> {
    return this.classService.findAll();
  }

  @Get('getClassOfTeacher')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    roles: [Role.TEACHER],
    permission: 'class.listByTeacher',
    description: 'Obtener todas las clases del docente',
  })
  @ApiOperation({
    summary: 'Obtener la clase del profito',
    description: 'Get all classes',
  })
  getClassOfTeacher(@Req() req): Promise<ClassForTeacherDto[]> {
    console.log('Usuario autenticado:', req.user); // Debugging
    const userId = req.user?.userId; // Verifica que exista

    if (!userId) {
      throw new BadRequestException('No se encontró el userId en la solicitud');
    }
    return this.classService.findClassesOfTeacher(userId);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'class.getById',
    description: 'Obtener una clase por id',
  })
  @ApiOperation({
    summary: 'Obtener una clase por id',
    description: 'Get a class by id',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ClassBaseDto> {
    return this.classService.findOne(id);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'class.updateById',
    description: 'Actualizar una clase por id',
  })
  @ApiOperation({
    summary: 'Actualizar una clase por id',
    description: 'Update a class by id',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateClassDto: UpdateClassDto,
  ): Promise<ClassBaseDto> {
    return await this.classService.update(id, updateClassDto);
  }

  @Patch(':id/meet-link')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    roles: [Role.MONITOR, Role.SUPERVISOR, Role.ADMIN],
    permission: 'class.updateMeetLink',
    description: 'Actualizar el enlace de Google Meet para una clase',
  })
  @ApiOperation({
    summary: 'Actualizar el enlace de Google Meet para una clase',
    description: 'Update Google Meet link for a class',
  })
  async updateMeetLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('urlMeet') urlMeet: string,
  ) {
    return await this.classService.updateMeetLink(id, urlMeet);
  }

  @Patch(':id/classroom-link')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    roles: [Role.MONITOR, Role.SUPERVISOR, Role.ADMIN],
    permission: 'class.updateClassroomLink',
    description: 'Actualizar el enlace de Google Classroom para una clase',
  })
  @ApiOperation({
    summary: 'Actualizar el enlace de Google Classroom para una clase',
    description: 'Update Google Classroom link for a class',
  })
  async updateClassroomLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('urlClassroom') urlClassroom: string,
  ) {
    return await this.classService.updateClassroomLink(id, urlClassroom);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authorization({
    permission: 'class.deleteById',
    description: 'Eliminar una clase por id',
  })
  @ApiOperation({
    summary: 'Eliminar una clase por id',
    description: 'Delete a class by id',
  })
  deleteArea(@Param('id', ParseUUIDPipe) id: string): Promise<ClassBaseDto> {
    return this.classService.delete(id);
  }
}
