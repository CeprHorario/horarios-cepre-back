/* eslint-disable prettier/prettier */
import { Injectable, NotFoundException, BadRequestException, ConflictException} from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import {
  CreateMonitorDto,
  UpdateMonitorDto,
  MonitorBaseDto,
  MonitorInformationDto,
} from './dto';
import { plainToInstance } from 'class-transformer';
import { ScheduleDto, Weekday } from './dto/schedule.dto';
import { TeacherResponseDto } from './dto/teacher-response.dto';
import { UpdateMonitorAsAdminDto } from './dto/updateMonitorAsAdmin.dto';
import { MonitorGetSummaryDto } from './dto/monitor-get-summary.dto';
import { MonitorWithoutSupervisorDto } from './dto/monitorWithoutSupervisor.dto';
import { MonitorGetByIdDto } from './dto/monitor-get-by-id.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class MonitorService {
  constructor(private prisma: PrismaService) {}

  // ─────── CRUD ───────
  async create(createMonitorDto: CreateMonitorDto): Promise<MonitorBaseDto> {
    const monitor = await this.prisma.getClient().monitor.create({
      data: createMonitorDto,
      include: { user: true, supervisors: true }, // Incluye la relación con el usuario
    });
    return this.mapToMonitorDto(monitor);
  }

  async findAll(): Promise<MonitorBaseDto[]> {
    const monitors = await this.prisma.getClient().monitor.findMany({
      include: { user: true, supervisors: true }, // Incluye la relación con el usuario
    });
    return monitors.map((monitor) => this.mapToMonitorDto(monitor));
  }

  async findAllBasicInfo(
    page: number = 1,
    limit: number = 20,
    areaId?: number,
    shiftId?: number,
  ): Promise<{
    data: MonitorGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;

    const activeFilter: Prisma.MonitorWhereInput = {
      user: {
        isActive: true,
      },...(areaId || shiftId
        ? {
            classes: {
              ...(areaId ? { areaId } : {}),
              ...(shiftId ? { shiftId } : {}),
            },
          }
        : {}),
    };

    const [monitors, total] = await this.prisma.getClient().$transaction([
      this.prisma.getClient().monitor.findMany({
        skip: offset,
        take: limit,
        where: activeFilter,
        include: {
          user: {
            include: {
              userProfile: true,
            },
          },
          classes: {
            select: {
              name: true,
              shift: {
                select: {
                  name: true
                }
              }
            },
          },
        },
      }),
      this.prisma.getClient().monitor.count({
        where: activeFilter,
      }),
    ]);

    const data = monitors.map((monitor) =>
      plainToInstance(MonitorGetSummaryDto, {
        id: monitor.id,
        firstName: monitor.user?.userProfile?.firstName || '',
        lastName: monitor.user?.userProfile?.lastName || '',
        email: monitor.user?.email || '',
        phone: monitor.user?.userProfile?.phone || '',
        className: monitor.classes?.name || '',
        shift: monitor.classes?.shift?.name || '',
      }),
    );

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<MonitorGetByIdDto> {
    try{
      const monitor = await this.prisma.getClient().monitor.findUnique({
        where: { id },
        include: {
          classes: {
            select: {
              name: true,
              urlMeet: true,
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
        },});

      if (!monitor) {
        throw new NotFoundException(`Monitor with ID ${id} not found`);
      }

      return plainToInstance(MonitorGetByIdDto, {
        monitorId: monitor.id,
        supervisorId: monitor.supervisorId,
        className: monitor.classes?.name || null,
        urlMeet: monitor.classes?.urlMeet || null,
        firstName: monitor.user?.userProfile?.firstName || '',
        lastName: monitor.user?.userProfile?.lastName || '',
        email: monitor.user?.email || '',
        phone: monitor.user?.userProfile?.phone || null,
      });
    } catch (error) {if (
            error instanceof NotFoundException ||
            error instanceof BadRequestException
          ) {
            throw error;
          }
          console.error('Error en findOne:', error); // Agregar un log para depuración
          throw new Error('Ocurrió un error inesperado al buscar el monitor');
    }

  }

  async update(
    id: string,
    updateMonitorDto: UpdateMonitorDto,
  ): Promise<MonitorBaseDto> {
    const monitor = await this.prisma.getClient().monitor.update({
      where: { id },
      data: updateMonitorDto,
      include: { user: true, supervisors: true }, // Incluye la relación con el usuario
    });
    return this.mapToMonitorDto(monitor);
  }

  async updateMonitorAsAdmin(
    id: string,
    updateMonitorDto: UpdateMonitorAsAdminDto,
  ): Promise<UpdateMonitorAsAdminDto> {
    const existingMonitor = await this.prisma.getClient().monitor.findUnique({
      where: { id },
      include: { user: { include: { userProfile: true } } },
    });

    console.log('Monitor encontrado antes de la actualización:', existingMonitor);

    if (!existingMonitor) {
      throw new NotFoundException(`Monitor with ID ${id} not found`);
    }

    // Verificar si el usuario tiene un perfil, si no, crearlo
    if (!existingMonitor.user.userProfile) {
      console.log('El usuario no tiene un perfil, creando uno...');
      await this.prisma.getClient().userProfile.create({
        data: {
          userId: existingMonitor.user.id,
          firstName: updateMonitorDto.firstName || '',
          lastName: updateMonitorDto.lastName || '',
          phone: updateMonitorDto.phone || '',
          dni: updateMonitorDto.dni || null,
        },
      });
    }
    if (updateMonitorDto.email) {
        const existingUser = await this.prisma.getClient().user.findFirst({
          where: {
            email: updateMonitorDto.email,
            NOT: {
              monitor: {
                id: id 
              }
            }
          }
        });
    
        if (existingUser) {
          throw new ConflictException('El correo electrónico ya está en uso por otro usuario');
        }
      }
    const monitor = await this.prisma.getClient().monitor.update({
      where: { id },
      data: {
        user: {
          update: {
            email: updateMonitorDto.email,
            userProfile: {
              update: {
                firstName: updateMonitorDto.firstName,
                lastName: updateMonitorDto.lastName,
                phone: updateMonitorDto.phone,
              },
            },
          },
        },
        classes: updateMonitorDto.className
          ? {
              connect: { id: updateMonitorDto.classId },
            }
          : undefined,
      },
      include: {
        user: {
          include: {
            userProfile: true,
          },
        },
        classes: {
          select: {
            name: true,
          },
        },
      },
    });

    return plainToInstance(UpdateMonitorAsAdminDto, {
      id: monitor.id,
      email: monitor.user.email,
      firstName: monitor.user.userProfile?.firstName || '',
      lastName: monitor.user.userProfile?.lastName || '',
      phone: monitor.user.userProfile?.phone || '',
      className: monitor.classes?.name || '',
    });
  }

  async delete(id: string): Promise<MonitorBaseDto> {
    const monitor = await this.prisma.getClient().monitor.delete({
      where: { id },
      include: { user: true, supervisors: true }, // Incluye la relación con el usuario
    });
    return this.mapToMonitorDto(monitor);
  }

  async getTeachersByMonitor(userId: string): Promise<TeacherResponseDto[]> {
    const teachers = await this.prisma.getClient().teacher.findMany({
      where: {
        schedules: {
          some: {
            clas: {
              monitor: {
                userId,
              },
            },
          },
        },
      },
      include: {
        user: {
          include: {
            userProfile: true,
          },
        },
        courses: true,
      },
      distinct: ['id'], // Asegura teachers únicos
    });

    if (!teachers.length) {
      throw new NotFoundException(
        'No se encontraron docentes asociados al monitor',
      );
    }

    return teachers.map((teacher) => ({
      teacherId: teacher.id,
      firstName: teacher.user.userProfile?.firstName || 'N/A',
      lastName: teacher.user.userProfile?.lastName || 'N/A',
      email: teacher.user.email,
      courseName: teacher.courses?.name || 'Sin asignar',
      phone: teacher.user.userProfile?.phone || 'N/A',
    }));
  }

  async getSchedule(userId: string): Promise<ScheduleDto[]> {
    const schedules = await this.prisma.getClient().schedule.findMany({
      relationLoadStrategy: 'join', // or 'query'
      where: {
        clas: {
          monitor: {
            userId,
          },
        },
      },
      select: {
        weekday: true,
        hourSession: {
          select: {
            startTime: true,
            endTime: true,
          },
        },
        teacher: {
          select: {
            courses: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!schedules.length) {
      throw new NotFoundException(
        'No se encontraron horarios para este monitor',
      );
    }

    return schedules.map((schedule) => ({
      weekday: schedule.weekday as Weekday,
      startTime: schedule.hourSession.startTime,
      endTime: schedule.hourSession.endTime,
      courseName: schedule.teacher?.courses?.name || 'Sin asignar',
    }));
  }

  async getInformationByMonitor(id: string): Promise<MonitorInformationDto> {
    const obj = await this.prisma.getClient().user.findUnique({
      where: { id },
      include: {
        userProfile: { select: { firstName: true, lastName: true } },
        monitor: {
          include: {
            classes: { select: { id: true, name: true, urlMeet: true ,urlClassroom:true} },
          },
        },
      },
    });

    if (!obj) throw new NotFoundException('Monitor no encontrado');

    return plainToInstance(MonitorInformationDto, {
      monitorId: obj.monitor?.id,
      nombres: obj.userProfile?.firstName,
      apellidos: obj.userProfile?.lastName,
      salon: obj.monitor?.classes?.name,
      salon_id: obj.monitor?.classes?.id,
      urlMeet: obj.monitor?.classes?.urlMeet,
      urlClassroom: obj.monitor?.classes?.urlClassroom,
    });
  }

  async deactivate(id: string) {
    const monitor = await this.prisma.getClient().monitor.findUnique({ 
      where: { id },
      include: { 
        user: {
          include: { 
            userProfile: 
              { select: { firstName: true, lastName: true } } 
            } 
      }
      } 
    });
    if (!monitor) {
      throw new NotFoundException('Monitor not found');
    }
    if (!monitor.user) {
      throw new NotFoundException('Associated user not found');
    }
    await this.prisma.getClient().user.update({
      where: { id: monitor.user.id },
      data: { isActive: false }
    });
    return plainToInstance(MonitorBaseDto, {
      firstName: monitor.user?.userProfile?.firstName || '',
      lastName: monitor.user?.userProfile?.lastName || ''
    });
  }

  async findAllWithSupervisor(
    hasSupervisor: boolean,
    shiftId?: number,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: MonitorWithoutSupervisorDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;
  
    const where: Prisma.MonitorWhereInput = {
      supervisorId: hasSupervisor ? { not: null } : null,
      classes: {
        ...(shiftId !== undefined ? { shiftId } : {}),
      },
    };
  
    const [monitors, total] = await this.prisma.getClient().$transaction([
      this.prisma.getClient().monitor.findMany({
        skip: offset,
        take: limit,
        where,
        select: {
          id: true,
          classes: {
            select: {
              id: true,
              name: true,
              shift: {
                select: { id: true, name: true },
              },
              area: {
                select: { id: true, name: true },
              },
            },
          },
          user: {
            select: {
              userProfile: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
              email: true
            }
          }
        },
        orderBy: { classes: { name: 'asc' } },
      }),
      this.prisma.getClient().monitor.count({ where }),
    ]);
  
    const data = monitors.map((monitor) => ({
      monitorId: monitor.id,
      className: monitor.classes?.name || 'no asignado',
      shiftId: monitor.classes?.shift?.id || 0,
      shiftName: monitor.classes?.shift?.name || 'no asignado',
      areaId: monitor.classes?.area?.id || 0,
      areaName: monitor.classes?.area?.name || 'no asignado',
      firstName: monitor.user?.userProfile?.firstName || 'no asignado',
      lastName: monitor.user?.userProfile?.lastName || 'no asignado',
      email: monitor.user?.email,
    }));
  
    return { data, total, page, limit };
  }

  // ─────── Métodos auxiliares ───────

  private mapToMonitorDto(obj: any): MonitorBaseDto {
    return plainToInstance(MonitorBaseDto, obj);
  }
}
