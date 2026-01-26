import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { CreateCourseDto, UpdateCourseDto } from './dto/index';
import { Prisma } from '@prisma/client';

@Injectable()
export class CourseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateCourseDto) {
    try {
      return await this.prisma.getClient().course.create({ data });
    } catch (error) {
      this.handleDatabaseError(error);
    }
  }

  async findAll() {
    try {
      return await this.prisma.getClient().course.findMany();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      throw new InternalServerErrorException('Error al obtener los cursos.');
    }
  }

  async findOne(id: number) {
    if (isNaN(id) || id <= 0) {
      throw new BadRequestException(
        'El ID del curso debe ser un número válido.',
      );
    }

    const course = await this.prisma
      .getClient()
      .course.findUnique({ where: { id } });
    if (!course) {
      throw new NotFoundException(`El curso con ID ${id} no existe.`);
    }
    return course;
  }

  async update(id: number, data: UpdateCourseDto) {
    await this.findOne(id); // Verifica que el curso existe antes de actualizar

    try {
      return await this.prisma
        .getClient()
        .course.update({ where: { id }, data });
    } catch (error) {
      this.handleDatabaseError(error);
    }
  }

  async remove(id: number) {
    await this.findOne(id); // Verifica que el curso existe antes de eliminar

    try {
      return await this.prisma.getClient().course.delete({ where: { id } });
    } catch (error) {
      this.handleDatabaseError(error);
    }
  }
  private handleDatabaseError(error: any): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.log('🔴 Prisma Error Code:', error.code, 'Message:', error.message);
      switch (error.code) {
        case 'P2002':
          throw new BadRequestException('Ya existe un curso con ese nombre.');
        case 'P2003':
          throw new BadRequestException(
            'No se puede eliminar el curso porque tiene profesores, horarios o relaciones asociadas.',
          );
        case 'P2025':
          throw new NotFoundException(
            'No se encontró el curso para actualizar o eliminar.',
          );
        default:
          throw new InternalServerErrorException(
            `Error de base de datos (${error.code}): ${error.message}`,
          );
      }
    }
    console.log('🔴 Error no manejado:', error);
    throw new InternalServerErrorException('Error interno del servidor.');
  }
}
