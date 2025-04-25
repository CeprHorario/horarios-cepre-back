import {  Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { TeacherBaseDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { CreateTeacherDto } from './dto/import-teacher.dto';
import { CreateTeacherWithUserDto } from './dto/create-teacher.dto';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { TeacherGetSummaryDto } from './dto/teacher-get-summary.dto';
import { TeacherUpdateDto } from './dto/teacher-update.dto';
import { TeacherGetByIdDto } from './dto/teacher-get-by-id.dto';
//import { Teacher } from '@prisma/client';

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
  }> {
    const offset = (page - 1) * limit;

    const activeFilter = {
      user: {
        isActive: true,
      },
    };

    const [teachers, total] = await this.prisma.getClient().$transaction([
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
      this.prisma.getClient().teacher.count({
        where: activeFilter,
      }),
    ]);

    const data = teachers.map((teacher) =>
      plainToInstance(TeacherGetSummaryDto, {
        id: teacher.id, 
        courseName: teacher.courses?.name || '',
        firstName: teacher.user?.userProfile?.firstName || '',
        lastName: teacher.user?.userProfile?.lastName || '',
        personalEmail: teacher.user?.userProfile?.personalEmail || null,
        phone: teacher.user?.userProfile?.phone || null,
        jobStatus: teacher.jobStatus || '',
        isCoordinator: teacher.isCoordinator || false,
      }),
    );

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<TeacherGetByIdDto> {
    try {
      const teacher = await this.prisma.getClient().teacher.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              email: true,
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
              id: true,
              name: true,
            },
          },
        },
      });

      if (!teacher) {
        throw new NotFoundException(`Teacher with ID ${id} not found`);
      }

      return plainToInstance(TeacherGetByIdDto, {
        teacherId: teacher.id,
        firstName: teacher.user?.userProfile?.firstName || '',
        lastName: teacher.user?.userProfile?.lastName || '',
        email: teacher.user?.email || '',
        personalEmail: teacher.user?.userProfile?.personalEmail || null,
        phone: teacher.user?.userProfile?.phone || null,
        courseId: teacher.courses?.id || '',
        courseName: teacher.courses?.name || '',
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Error en findOne:', error); // Agregar un log para depuración
      throw new Error('Ocurrió un error inesperado al buscar el profesor');
    }
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

  async createManyTeachers(dtos: CreateTeacherDto[]) {
    const prisma = this.prisma.getClient();

    const existingUsers = await prisma.user.findMany({
      where: {
        email: {
          in: dtos.map((dto) => dto.email),
        },
      },
      select: { email: true },
    });
  
    const existingEmails = new Set(existingUsers.map((u) => u.email));

    const duplicated = dtos.filter((dto) => existingEmails.has(dto.email));
    const toCreate = dtos.filter((dto) => !existingEmails.has(dto.email));

    if (toCreate.length === 0) {
      return {
        creados: [],
        noCreados: duplicated.map(d => ({ email: d.email, dni: d.dni })),
      };
    }

    const result = await prisma.$transaction(
      toCreate.map((dto) =>
        prisma.user.create({
          data: {
            email: dto.email,
            role: Role.TEACHER,
            userProfile: {
              create: {
                dni: dto.dni,
                firstName: dto.firstName,
                lastName: dto.lastName,
                phone: dto.phone,
                phonesAdditional: dto.phonesAdditional ?? [],
                personalEmail: dto.personalEmail || null,
              },
            },
            teacher: {
              create: {
                courseId: dto.courseId,
                maxHours: dto.maxHours,
                scheduledHours: 0,
                jobStatus: dto.jobStatus,
              },
            },
          },
          include: {
            teacher: true,
            userProfile: true,
          },
        })
      )
    );
  
    return {
      creados: result.map((r) => ({
        email: r.email,
        dni: r.userProfile?.dni,
      })),
      noCreados: duplicated.map(d => ({ email: d.email, dni: d.dni })),
    };
  }
  
  

  async deactivate(id: string) {
    const teacher = await this.prisma.getClient().teacher.findUnique({ 
      where: { id },
      include: { 
        user: {
          include: { 
            userProfile: 
              { select: { firstName: true, lastName: true } } 
            } 
      }
      }  // Incluir la relación con usuario
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
    return plainToInstance(TeacherBaseDto, {
          firstName: teacher.user?.userProfile?.firstName || '',
          lastName: teacher.user?.userProfile?.lastName || ''
    });
    
  }

  //async getTeacherSchedules(teacherId: string) {
  //  return Promise.resolve(undefined);
  //}
}
