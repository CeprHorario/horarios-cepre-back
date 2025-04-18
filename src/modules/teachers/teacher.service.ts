import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { TeacherBaseDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { ImportTeacherDto } from './dto/import-teacher.dto';
import { CreateTeacherWithUserDto } from './dto/create-teacher.dto';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { TeacherGetSummaryDto } from './dto/teacher-get-summary.dto';
import { TeacherUpdateDto } from './dto/teacher-update.dto';

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
    data: TeacherGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
    activeCount: number; // Nuevo campo para el conteo de activos
  }> {
    const offset = (page - 1) * limit;

    const activeFilter = {
      user: {
        isActive: true,
      },
    };

    const [teachers, total, activeCount] = await this.prisma.getClient().$transaction([
      this.prisma.getClient().teacher.findMany({
        skip: offset,
        take: limit,
        relationLoadStrategy: 'join',
        where: activeFilter,
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
      this.prisma.getClient().teacher.count({
        where: activeFilter,
      }), 
    ]);

    const data = teachers.map((teacher) =>
      plainToInstance(TeacherGetSummaryDto, {
        id: teacher.id, // Incluye el ID en el mapeo
        courseName: teacher.courses?.name || '',
        firstName: teacher.user?.userProfile?.firstName || '',
        lastName: teacher.user?.userProfile?.lastName || '',
        personalEmail: teacher.user?.userProfile?.personalEmail || null,
        phone: teacher.user?.userProfile?.phone || null,
        jobStatus: teacher.jobStatus || '',
        isCoordinator: teacher.isCoordinator || false,
      }),
    );

    return { data, total, page, limit, activeCount };
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
    updateTeacherDto: TeacherUpdateDto,
  ): Promise<TeacherGetSummaryDto> {
    const teacher = await this.prisma.getClient().teacher.update({
      where: { id },
      data: {
        jobStatus: updateTeacherDto.jobStatus,
        isCoordinator: updateTeacherDto.isCoordinator,
        user: {
          update: {
            userProfile: {
              update: {
                firstName: updateTeacherDto.firstName,
                lastName: updateTeacherDto.lastName,
                personalEmail: updateTeacherDto.personalEmail,
                phone: updateTeacherDto.phone,
              },
            },
          },
        },
        ...(updateTeacherDto.courseName && {
          courses: {
            connect: { name: updateTeacherDto.courseName },
          },
        }),
      },
      include: {
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
        courses: {
          select: {
            name: true,
          },
        },
      },
    });

    return plainToInstance(TeacherGetSummaryDto, {
      id: teacher.id,
      courseName: teacher.courses?.name || '',
      firstName: teacher.user?.userProfile?.firstName || '',
      lastName: teacher.user?.userProfile?.lastName || '',
      personalEmail: teacher.user?.userProfile?.personalEmail || null,
      phone: teacher.user?.userProfile?.phone || null,
      jobStatus: teacher.jobStatus || '',
      isCoordinator: teacher.isCoordinator || false,
    });
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

  async deactivate(id: string) {
    const teacher = await this.prisma.getClient().teacher.findUnique({ 
      where: { id },
      include: { user: true } // Incluir la relación con usuario
    });
    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }
    if (!teacher.user) {
      throw new NotFoundException('Associated user not found');
    }
    // Actualizar el estado isActive del usuario relacionado
    await this.prisma.getClient().user.update({
      where: { id: teacher.user.id },
      data: { isActive: false }
    });
    return this.prisma.getClient().teacher.findUnique({
      where: { id },
      include: { user: true }
    });
  }

  //async getTeacherSchedules(teacherId: string) {
  //  return Promise.resolve(undefined);
  //}
}
