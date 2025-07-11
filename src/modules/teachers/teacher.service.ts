import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
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
import { Prisma } from '@prisma/client';
import { ScheduleTeacherDto } from './dto/schedule-teacher.dto';
import { TeacherFilteredDto } from '@modules/teachers/dto/teacherFiltered.dto';
import { JobStatus } from '@prisma/client';

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
    courseId?: number,
  ): Promise<{
    data: TeacherGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;

    const where: Prisma.TeacherWhereInput = {
      user: {
        isActive: true,
      },
      ...(courseId !== undefined && { courses: { id: courseId } }),
    };

    const [teachers, total] = await this.prisma.getClient().$transaction([
      this.prisma.getClient().teacher.findMany({
        skip: limit > 0 ? offset : undefined,
        take: limit > 0 ? limit : undefined,
        relationLoadStrategy: 'join',
        where: where,
        orderBy: {
          user: {
            userProfile: {
              lastName: 'asc',
            },
          },
        },
        select: {
          id: true,
          jobStatus: true,
          isCoordinator: true,
          maxHours: true,
          courses: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              email: true,
              userProfile: {
                select: {
                  firstName: true,
                  lastName: true,
                  phone: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.getClient().teacher.count({
        where: where,
      }),
    ]);

    const data = teachers.map((teacher) =>
      plainToInstance(TeacherGetSummaryDto, {
        id: teacher.id,
        courseId: teacher.courses?.id || '',
        courseName: teacher.courses?.name || '',
        firstName: teacher.user?.userProfile?.firstName || '',
        lastName: teacher.user?.userProfile?.lastName || '',
        email: teacher.user?.email || null,
        phone: teacher.user?.userProfile?.phone || null,
        jobStatus: teacher.jobStatus || '',
        isCoordinator: teacher.isCoordinator || false,
        maxHours: teacher.maxHours || null,
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
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
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
    // 1. Verificar si el email ya existe en otro usuario
    if (updateTeacherDto.email) {
      const existingUser = await this.prisma.getClient().user.findFirst({
        where: {
          email: updateTeacherDto.email,
          NOT: {
            teacher: {
              id: id,
            },
          },
        },
      });
      if (existingUser) {
        throw new ConflictException(
          'El correo electrónico ya está en uso por otro usuario',
        );
      }
    }
    const teacher = await this.prisma.getClient().teacher.update({
      where: { id },
      data: {
        jobStatus: updateTeacherDto.jobStatus,
        isCoordinator: updateTeacherDto.isCoordinator,
        maxHours: updateTeacherDto.maxHours,
        user: {
          update: {
            email: updateTeacherDto.email,
            userProfile: {
              update: {
                firstName: updateTeacherDto.firstName,
                lastName: updateTeacherDto.lastName,
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
            email: true,
            userProfile: {
              select: {
                firstName: true,
                lastName: true,
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
      email: teacher.user?.email || null,
      courseName: teacher.courses?.name || '',
      firstName: teacher.user?.userProfile?.firstName || '',
      lastName: teacher.user?.userProfile?.lastName || '',
      phone: teacher.user?.userProfile?.phone || null,
      jobStatus: teacher.jobStatus || '',
      isCoordinator: teacher.isCoordinator || false,
      maxHours: teacher.maxHours || null,
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
    type UserWithRelations = Prisma.UserGetPayload<{
      include: {
        teacher: true;
        userProfile: true;
      };
    }>;

    const validDtos = dtos.map((dto) => ({
      ...dto,
      phonesAdditional: dto.phonesAdditional ?? [],
      personalEmail: dto.personalEmail ?? null,
      isCoordinator: dto.isCoordinator ?? false,
    }));
    const prisma = this.prisma.getClient();

    const [existingUsers, existingProfiles] = await Promise.all([
      prisma.user.findMany({
        where: {
          email: {
            in: validDtos.map((dto) => dto.email),
          },
        },
        select: { email: true },
      }),
      prisma.userProfile.findMany({
        where: {
          dni: {
            in: validDtos.map((dto) => dto.dni),
          },
        },
        select: { dni: true },
      }),
    ]);

    const existingEmails = new Set(existingUsers.map((u) => u.email));
    const existingDnis = new Set(existingProfiles.map((p) => p.dni));

    const duplicated = validDtos.filter(
      (dto) => existingEmails.has(dto.email) || existingDnis.has(dto.dni),
    );
    const toCreate = validDtos.filter(
      (dto) => !existingEmails.has(dto.email) && !existingDnis.has(dto.dni),
    );

    if (toCreate.length === 0) {
      return {
        creados: [],
        noCreados: duplicated.map((d) => ({
          email: d.email,
          dni: d.dni,
          motivo: existingEmails.has(d.email)
            ? 'email duplicado'
            : 'dni duplicado',
        })),
      };
    }

    try {
      const createData = toCreate.map((dto) => {
        const {
          jobStatus,
          courseId,
          isCoordinator,
          email,
          dni,
          firstName,
          lastName,
          phone,
          phonesAdditional,
          personalEmail,
        } = dto;

        // Calculate maxHours based on rules
        let maxHours: number;
        if (isCoordinator) {
          maxHours = jobStatus === 'FullTime' ? 12 : 16;
        } else if (courseId === 12) {
          maxHours = jobStatus === 'FullTime' ? 16 : 21;
        } else {
          maxHours = jobStatus === 'FullTime' ? 16 : 20;
        }

        return {
          email,
          role: Role.TEACHER,
          userProfile: {
            create: {
              dni,
              firstName,
              lastName,
              phone,
              phonesAdditional: phonesAdditional ?? [],
              personalEmail: personalEmail ?? null,
            },
          },
          teacher: {
            create: {
              courseId,
              maxHours,
              scheduledHours: 0,
              jobStatus,
              isCoordinator: isCoordinator ?? false,
            },
          },
        };
      });

      const chunkSize = 30;
      const results: UserWithRelations[] = [];

      for (let i = 0; i < createData.length; i += chunkSize) {
        const chunk = createData.slice(i, i + chunkSize);
        const chunkResults = await prisma.$transaction(
          chunk.map((userData) =>
            prisma.user.create({
              data: userData,
              include: {
                teacher: true,
                userProfile: true,
              },
            }),
          ),
        );

        results.push(...chunkResults);
      }

      return {
        creados: results.map((r) => ({
          email: r.email,
          dni: r.userProfile?.dni,
        })),
        noCreados: duplicated.map((d) => ({
          email: d.email,
          dni: d.dni,
          motivo: existingEmails.has(d.email)
            ? 'email duplicado'
            : 'dni duplicado',
        })),
      };
    } catch (error) {
      console.error('Error al crear usuarios:', error);
      throw new Error('Error creando profesores. No se creó ningún profesor.');
    }
  }

  async deactivate(id: string) {
    const teacher = await this.prisma.getClient().teacher.findUnique({
      where: { id },
      include: {
        user: {
          include: {
            userProfile: { select: { firstName: true, lastName: true } },
          },
        },
      }, // Incluir la relación con usuario
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
      data: { isActive: false },
    });
    return plainToInstance(TeacherBaseDto, {
      firstName: teacher.user?.userProfile?.firstName || '',
      lastName: teacher.user?.userProfile?.lastName || '',
    });
  }

  async search(
    query: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: TeacherGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;

    const [teachers, total] = await this.prisma.getClient().$transaction([
      this.prisma.getClient().teacher.findMany({
        skip: limit > 0 ? offset : undefined,
        take: limit > 0 ? limit : undefined,
        where: {
          OR: [
            {
              user: {
                userProfile: {
                  firstName: { contains: query, mode: 'insensitive' },
                },
              },
            },
            {
              user: {
                userProfile: {
                  lastName: { contains: query, mode: 'insensitive' },
                },
              },
            },
            {
              user: {
                userProfile: {
                  personalEmail: { contains: query, mode: 'insensitive' },
                },
              },
            },
            {
              user: {
                userProfile: {
                  phone: { contains: query, mode: 'insensitive' },
                },
              },
            },
          ],
        },
        select: {
          id: true,
          jobStatus: true,
          isCoordinator: true,
          user: {
            select: {
              userProfile: {
                select: {
                  firstName: true,
                  lastName: true,
                  phone: true,
                  personalEmail: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.getClient().teacher.count({
        where: {
          OR: [
            {
              user: {
                userProfile: {
                  firstName: { contains: query, mode: 'insensitive' },
                },
              },
            },
            {
              user: {
                userProfile: {
                  lastName: { contains: query, mode: 'insensitive' },
                },
              },
            },
            {
              user: {
                userProfile: {
                  personalEmail: { contains: query, mode: 'insensitive' },
                },
              },
            },
            {
              user: {
                userProfile: {
                  phone: { contains: query, mode: 'insensitive' },
                },
              },
            },
          ],
        },
      }),
    ]);

    const data = teachers.map((teacher) =>
      plainToInstance(TeacherGetSummaryDto, {
        id: teacher.id,
        email: teacher.user?.userProfile?.personalEmail || '',
        firstName: teacher.user?.userProfile?.firstName || '',
        lastName: teacher.user?.userProfile?.lastName || '',
        phone: teacher.user?.userProfile?.phone || null,
        jobStatus: teacher.jobStatus || '',
        isCoordinator: teacher.isCoordinator || false,
      }),
    );

    return { data, total, page, limit };
  }

  async findByCourse(
    courseId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: TeacherGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;

    const [teachers, total] = await this.prisma.getClient().$transaction([
      this.prisma.getClient().teacher.findMany({
        skip: limit > 0 ? offset : undefined,
        take: limit > 0 ? limit : undefined,
        relationLoadStrategy: 'join',
        where: {
          courseId: Number(courseId),
          user: { isActive: true },
        },
        select: {
          id: true,
          jobStatus: true,
          isCoordinator: true,
          courses: {
            select: { name: true },
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
        where: {
          courseId: Number(courseId),
          user: { isActive: true },
        },
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

  //async getTeacherSchedules(teacherId: string) {
  //  return Promise.resolve(undefined);
  //}
  async getTeacherSchedules(teacherId: string): Promise<ScheduleTeacherDto[]> {
    const schedules = await this.prisma.getClient().schedule.findMany({
      where: { teacherId },
      include: {
        course: {
          select: {
            id: true,
            name: true,
          },
        },
        clas: {
          select: {
            id: true,
            name: true,
            area: {
              select: {
                id: true,
                name: true,
              },
            },
            shift: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        hourSession: {
          select: {
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    return Array.from(
      schedules
        .reduce((map, s) => {
          const key = s.clas.id;
          if (!map.has(key))
            map.set(key, {
              classId: s.clas.id,
              className: s.clas.name,
              courseId: s.course.id,
              courseName: s.course.name,
              areaId: s.clas.area.id,
              areaName: s.clas.area.name,
              shiftId: s.clas.shift.id,
              shiftName: s.clas.shift.name,
              schedules: [],
            });
          map.get(key)!.schedules.push({
            weekday: s.weekday,
            hourSession: {
              startTime: s.hourSession.startTime.toISOString(),
              endTime: s.hourSession.endTime.toISOString(),
            },
          });
          return map;
        }, new Map<string, ScheduleTeacherDto>())
        .values(),
    );
  }

  async getFilteredTeachers(
    body: TeacherFilteredDto,
    page: number,
    limit: number,
  ) {
    // Validar hourSessions
    const hourSessionIds = [
      ...new Set(body.hourSessions.map((h) => h.hourSessionId)),
    ];
    const count = await this.prisma.getClient().hourSession.count({
      where: { id: { in: hourSessionIds } },
    });
    if (count !== hourSessionIds.length) {
      throw new NotFoundException('Some hour sessions do not exist');
    }

    // Buscar profesores que tengan horas disponibles
    const ids = await this.prisma.getClient().$queryRaw<{ id: string }[]>`
      SELECT id FROM "teachers"
      WHERE course_id = ${body.courseId} AND (max_hours - scheduled_hours) >= ${body.hourSessions.length}
    `;
    if (ids.length === 0) return { data: [], page, limit };

    // Verificar si hay profesores disponibles
    const offset = (page - 1) * limit;
    const teachers = await this.prisma.getClient().teacher.findMany({
      skip: offset,
      take: limit,
      where: {
        id: { in: ids.map((t) => t.id) },
        AND: body.hourSessions.map(({ hourSessionId, weekday }) => ({
          schedules: {
            none: {
              hourSessionId,
              weekday,
            },
          },
        })),
      },
      select: {
        id: true,
        jobStatus: true,
        isCoordinator: true,
        user: {
          select: {
            email: true,
            userProfile: {
              select: {
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    const data = teachers.map((teacher) =>
      plainToInstance(TeacherGetSummaryDto, {
        id: teacher.id,
        firstName: teacher.user?.userProfile?.firstName || '',
        lastName: teacher.user?.userProfile?.lastName || '',
        email: teacher.user?.email || '',
        phone: teacher.user?.userProfile?.phone || null,
        jobStatus: teacher.jobStatus || JobStatus.FullTime,
        isCoordinator: teacher.isCoordinator || false,
      }),
    );

    return { data, page, limit };
  }
}
