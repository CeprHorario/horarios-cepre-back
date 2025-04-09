import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { UpdateTeacherDto, TeacherBaseDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { ImportTeacherDto } from './dto/import-teacher.dto';
import { CreateTeacherWithUserDto } from './dto/create-teacher.dto';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { TeacherSummaryDto } from './dto/teacher-summary.dto';

@Injectable()
export class TeacherService {
  constructor(private prisma: PrismaService) {}

  // ─────── CRUD ───────
  async createTeacher(
    createDto: CreateTeacherWithUserDto,
  ): Promise<TeacherBaseDto> {
    return this.prisma.getClient().$transaction(async (tx) => {
      // Verificar que el curso existe
      const courseExists = await tx.course.findUnique({
        where: { id: createDto.courseId },
      });

      if (!courseExists) {
        throw new NotFoundException(
          `Course with ID ${createDto.courseId} not found`,
        );
      }

      // Crear usuario, perfil y profesor
      const user = await tx.user.create({
        data: {
          email: createDto.email,
          role: Role.TEACHER,
          isActive: true,
          userProfile: {
            create: {
              dni: createDto.dni,
              firstName: createDto.firstName,
              lastName: createDto.lastName,
              phone: createDto.phone,
              phonesAdditional: createDto.phonesAdditional || [],
              personalEmail: createDto.personalEmail,
            },
          },
          teacher: {
            create: {
              maxHours: createDto.maxHours,
              scheduledHours: createDto.scheduledHours,
              jobStatus: createDto.jobStatus,
              isActive: true,
              courseId: createDto.courseId,
              isCoordinator: createDto.isCoordinator || false,
            },
          },
        },
        include: {
          userProfile: true,
          teacher: {
            include: {
              courses: true,
            },
          },
        },
      });

      return this.mapToTeacherDto(user);
    });
  }

  async findAll(
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: TeacherSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;

    const [teachers, total] = await this.prisma.getClient().$transaction([
      this.prisma.getClient().teacher.findMany({
        skip: offset,
        take: limit,
        relationLoadStrategy: 'join',
        select: {
          id: true,
          jobStatus: true,
          isCoordinator: true,
          courses: {
            select: {
              name: true,
            },
          },
          user: {
            select: {
              userProfile: {
                select: {
                  firstName: true,
                  lastName: true,
                  personalEmail: true,
                  phone: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.getClient().teacher.count(),
    ]);

    const data = teachers.map((teacher) => ({
      id: teacher.id || '',
      courseName: teacher.courses?.name || '',
      firstName: teacher.user?.userProfile?.firstName || '',
      lastName: teacher.user?.userProfile?.lastName || '',
      personalEmail: teacher.user?.userProfile?.personalEmail || '',
      phone: teacher.user?.userProfile?.phone || '',
      jobStatus: teacher.jobStatus || '',
      isCoordinator: teacher.isCoordinator || false,
    }));

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<TeacherBaseDto> {
    const teacher = await this.prisma.getClient().teacher.findUnique({
      where: { id },
      include: { user: true }, // Incluye la relación con el usuario
    });
    if (!teacher) {
      throw new NotFoundException(`Teacher with ID ${id} not found`);
    }
    return this.mapToTeacherDto(teacher);
  }

  async update(
    id: string,
    updateTeacherDto: UpdateTeacherDto,
  ): Promise<TeacherBaseDto> {
    const teacher = await this.prisma.getClient().teacher.update({
      where: { id },
      data: updateTeacherDto,
      include: { user: true, courses: true }, // Incluye la relación con el usuario
    });
    return this.mapToTeacherDto(teacher);
  }

  async delete(id: string): Promise<TeacherBaseDto> {
    const teacher = await this.prisma.getClient().teacher.delete({
      where: { id },
      include: { user: true, courses: true }, // Incluye la relación con el usuario
    });
    return this.mapToTeacherDto(teacher);
  }

  // ─────── Métodos auxiliares ───────

  private mapToTeacherDto(obj: any): TeacherBaseDto {
    return plainToInstance(TeacherBaseDto, obj);
  }

  async createTeachersFromJson(data: ImportTeacherDto[]) {
    if (data.length === 0) return { message: 'No hay datos para procesar' };

    return this.prisma.getClient().$transaction(async (tx) => {
      const courseNames = [...new Set(data.map((t) => t.courseName))]; // Eliminar nombres duplicados
      const courses = await tx.course.findMany({
        where: { name: { in: courseNames } },
        select: { id: true, name: true },
      });

      const courseMap = new Map(courses.map((c) => [c.name, c.id]));

      const missingCourses = courseNames.filter((name) => !courseMap.has(name));
      if (missingCourses.length > 0) {
        throw new Error(
          `Los siguientes cursos no existen: ${missingCourses.join(', ')}`,
        );
      }

      // Crear los usuarios
      await tx.user.createMany({
        data: data.map((t) => ({
          email: t.email,
          role: 'profesor',
          isActive: true,
        })),
      });

      // Obtener los nuevos usuarios creados
      const newUsers = await tx.user.findMany({
        where: {
          email: { in: data.map((t) => t.email) },
        },
        select: { id: true, email: true },
      });

      // Mapear emails a IDs de usuario
      const userMap = new Map(newUsers.map((u) => [u.email, u.id]));

      // Crear los perfiles de usuario
      await tx.userProfile.createMany({
        data: data.map((t) => ({
          userId: userMap.get(t.email)!,
          dni: t.dni,
          firstName: t.firstName,
          lastName: t.lastName,
          phone: t.phone,
          phonesAdditional: t.phonesAdditional || [],
          personalEmail: t.personalEmail,
        })),
      });

      // Crear los profesores con el `jobStatus` y `courseId`
      await tx.teacher.createMany({
        data: data.map((t) => ({
          userId: userMap.get(t.email)!,
          courseId: courseMap.get(t.courseName)!, // Obtener el ID del curso
          jobStatus: t.jobStatus,
        })),
      });

      return {
        message: 'Profesores creados correctamente',
        inserted: data.length,
      };
    });
  }

  //async getTeacherSchedules(teacherId: string) {
  //  return Promise.resolve(undefined);
  //}
}
