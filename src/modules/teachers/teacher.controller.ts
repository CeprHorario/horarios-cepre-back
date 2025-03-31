import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Put,
  Delete,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { TeacherService } from './teacher.service';
import { CreateTeacherDto, UpdateTeacherDto } from './dto';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { Readable } from 'stream';
import { ImportTeacherDto } from './dto/import-teacher.dto';
//import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import csvParser from 'csv-parser';
import { Unauthenticated } from '@modules/auth/decorators/unauthenticated.decorator';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Teachers')
@Controller('teachers')
export class TeacherController {
  constructor(private readonly teacherService: TeacherService) {}

  @Post()
  @Authorization({
    permission: 'teacher.create',
    description: 'Crear un nuevo profesor',
  })
  create(@Body() createTeacherDto: CreateTeacherDto) {
    return this.teacherService.create(createTeacherDto);
  }

  @Get()
  @Authorization({
    permission: 'teacher.list',
    description: 'Obtener todos los profesores',
  })
  findAll() {
    return this.teacherService.findAll();
  }

  @Get(':id')
  @Authorization({
    permission: 'teacher.getById',
    description: 'Obtener un profesor por su id',
  })
  findOne(@Param('id') id: string) {
    return this.teacherService.findOne(id);
  }

  @Put(':id')
  @Authorization({
    permission: 'teacher.update',
    description: 'Actualizar un profesor por su id',
  })
  update(@Param('id') id: string, @Body() updateTeacherDto: UpdateTeacherDto) {
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
  @Unauthenticated()
  @Authorization({
    permission: 'teacher.importjson',
    description: 'Eliminar un profesor por su id',
  })
  @ApiOperation({
    summary: 'Crear profesores desde un archivo JSON',
  })
  @ApiBody({ type: [ImportTeacherDto] })
  async createTeachersFromJson(@Body() importTeacherDto: ImportTeacherDto[]) {
    return this.teacherService.createTeachersFromJson(importTeacherDto);
  }

  // ✅ Cargar desde CSV
  @Post('csv')
  @Unauthenticated()
  @Authorization({
    permission: 'teacher.importcsv',
    description: 'Eliminar un profesor por su id',
  })
  @UseInterceptors(FileInterceptor('file'))
  async createTeachersFromCsv(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const records: ImportTeacherDto[] = [];

    return new Promise((resolve, reject) => {
      Readable.from(file.buffer)
        .pipe(csvParser())
        .on('data', row => {
          records.push({
            email: row.email,
            dni: row.dni,
            firstName: row.first_name,
            lastName: row.last_name,
            phone: row.phone || null,
            phonesAdditional: row.phone_aditional ? row.phone_aditional.split(';') : [],
            personalEmail: row.personal_email || null,
            isActive: true,
            jobStatus: row.job_status || null,
            courseName: row.course_name || null,
          });
        })
        .on('end', async () => {
          try {
            const result = await this.teacherService.createTeachersFromJson(records);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
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
