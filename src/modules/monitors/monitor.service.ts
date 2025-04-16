import { Injectable, NotFoundException } from '@nestjs/common';
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
  ): Promise<{
    data: MonitorGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;

    const [monitors, total] = await this.prisma.getClient().$transaction([
      this.prisma.getClient().monitor.findMany({
        skip: offset,
        take: limit,
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
      }),
      this.prisma.getClient().monitor.count(),
    ]);

    const data = monitors.map((monitor) =>
      plainToInstance(MonitorGetSummaryDto, {
        id: monitor.id,
        firstName: monitor.user?.userProfile?.firstName || '',
        lastName: monitor.user?.userProfile?.lastName || '',
        personalEmail: monitor.user?.userProfile?.personalEmail || '',
        phone: monitor.user?.userProfile?.phone || '',
        className: monitor.classes?.name || 'Sin asignar',
      }),
    );

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<MonitorBaseDto> {
    const monitor = await this.prisma.getClient().monitor.findUnique({
      where: { id },
      include: { user: true, supervisors: true }, // Incluye la relación con el usuario
    });
    if (!monitor) {
      throw new NotFoundException(`Monitor with ID ${id} not found`);
    }
    return this.mapToMonitorDto(monitor);
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
    monitorId: string,
    updateMonitorDto: UpdateMonitorAsAdminDto,
  ): Promise<MonitorGetSummaryDto> {
    const monitor = await this.prisma.getClient().monitor.update({
      where: { id: monitorId },
      data: {
        user: {
          update: {
            userProfile: {
              update: {
                firstName: updateMonitorDto.firstName,
                lastName: updateMonitorDto.lastName,
                personalEmail: updateMonitorDto.personalEmail,
                phone: updateMonitorDto.phone,
              },
            },
          },
        },
        classes: updateMonitorDto.className
          ? {
              connect: { id: updateMonitorDto.classId }, // Cambiado a `id`
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

    return plainToInstance(MonitorGetSummaryDto, {
      id: monitor.id,
      firstName: monitor.user.userProfile?.firstName || '',
      lastName: monitor.user.userProfile?.lastName || '',
      personalEmail: monitor.user.userProfile?.personalEmail || '',
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
            classes: { select: { id: true, name: true, urlMeet: true } },
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
    });
  }

  // ─────── Métodos auxiliares ───────

  private mapToMonitorDto(obj: any): MonitorBaseDto {
    return plainToInstance(MonitorBaseDto, obj);
  }
}
