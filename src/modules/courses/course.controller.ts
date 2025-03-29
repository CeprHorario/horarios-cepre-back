import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  ParseIntPipe,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { CourseService } from './course.service';
import { CreateCourseDto, UpdateCourseDto } from './dto';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';
import {Unauthenticated} from "@modules/auth/decorators/unauthenticated.decorator";

@ApiTags('Courses')
@Controller('courses')
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  @Post()
  @Authorization({
    permission: 'courses.create',
    description: 'crear un nuevo curso',
  })
  @ApiOperation({ summary: 'Crear un nuevo curso' })
  @ApiResponse({ status: 201, description: 'Curso creado exitosamente.' })
  @ApiResponse({ status: 400, description: 'Datos inválidos.' })
  @ApiBody({ type: CreateCourseDto })
  async create(@Body() createCourseDto: CreateCourseDto) {
    try {
      return await this.courseService.create(createCourseDto);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      throw new HttpException(
        'Error al crear el curso',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get()
  @Unauthenticated()
  @ApiOperation({ summary: 'Obtener todos los cursos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de cursos obtenida con éxito.',
  })
  async findAll() {
    return await this.courseService.findAll();
  }

  @Get(':id')
  @Authorization({
    permission: 'courses.searchId',
    description: 'Obtener un curso por id',
  })
  @ApiOperation({ summary: 'Obtener un curso por ID' })
  @ApiResponse({ status: 200, description: 'Curso encontrado.' })
  @ApiResponse({ status: 404, description: 'Curso no encontrado.' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const course = await this.courseService.findOne(id);
    if (!course) {
      throw new HttpException('Curso no encontrado', HttpStatus.NOT_FOUND);
    }
    return course;
  }

  @Put(':id')
  @Authorization({
    permission: 'courses.update',
    description: 'Actualizar un curso',
  })
  @ApiOperation({ summary: 'Actualizar un curso' })
  @ApiResponse({ status: 200, description: 'Curso actualizado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Curso no encontrado.' })
  @ApiBody({ type: UpdateCourseDto })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCourseDto: UpdateCourseDto,
  ) {
    const updatedCourse = await this.courseService.update(id, updateCourseDto);
    if (!updatedCourse) {
      throw new HttpException('Curso no encontrado', HttpStatus.NOT_FOUND);
    }
    return updatedCourse;
  }

  @Delete(':id')
  @Authorization({
    permission: 'courses.delete',
    description: 'Eliminar un curso',
  })
  @ApiOperation({ summary: 'Eliminar un curso' })
  @ApiResponse({ status: 200, description: 'Curso eliminado exitosamente.' })
  @ApiResponse({ status: 404, description: 'Curso no encontrado.' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    const deleted = await this.courseService.remove(id);
    if (!deleted) {
      throw new HttpException('Curso no encontrado', HttpStatus.NOT_FOUND);
    }
    return { message: 'Curso eliminado correctamente' };
  }
}
