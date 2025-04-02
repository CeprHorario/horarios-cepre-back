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
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ClassService } from './class.service';
//import { Prisma } from '@prisma/client';
import {
  CreateClassDto,
  UpdateClassDto,
  ClassBaseDto,
  ClassForTeacherDto,
} from './dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Authorization, Role } from '@modules/auth/decorators/authorization.decorator';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';

@Controller('classes')
@ApiTags('Classes')
@UseGuards(JwtAuthGuard)
export class ClassController {
  constructor(private readonly classService: ClassService) {}

  // ─────── CRUD ───────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authorization({
    permission: 'class.create',
    description: 'Crear una nueva clase',
  })
  @ApiOperation({
    summary: 'Crear una nueva clase',
    description: 'Create a new class',
  })
  create(@Body() createClassDto: CreateClassDto): Promise<ClassBaseDto> {
    return this.classService.create(createClassDto);
  }

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
