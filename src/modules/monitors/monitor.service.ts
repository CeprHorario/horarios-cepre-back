import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { CreateMonitorDto, UpdateMonitorDto, MonitorBaseDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { ScheduleDto, Weekday } from './dto/schedule.dto';
import { TeacherResponseDto } from './dto/teacher-response.dto';

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

  async delete(id: string): Promise<MonitorBaseDto> {
    const monitor = await this.prisma.getClient().monitor.delete({
      where: { id },
      include: { user: true, supervisors: true }, // Incluye la relación con el usuario
    });
    return this.mapToMonitorDto(monitor);
  }

  async getTeachersByMonitor(userId: string): Promise<TeacherResponseDto[]> {
    // Obtener las clases asignadas al monitor
    const classes = await this.prisma.getClient().class.findMany({
      where: { monitorId: userId },
      include: {
        schedules: {
          include: {
            teacher: {
              include: {
                user: {
                  include: { userProfile: true },
                },
                courses: true,
              },
            },
          },
        },
      },
    });

    if (!classes.length) {
      throw new NotFoundException('No se encontraron clases asignadas al monitor');
    }

    // Extraer los docentes únicos de los horarios
    const teachersMap = new Map();
    classes.forEach((c) => {
      c.schedules.forEach((s) => {
        if (s.teacher) {
          teachersMap.set(s.teacher.id, {
            teacherId: s.teacher.id,
            firstName: s.teacher.user.userProfile?.firstName || 'N/A',
            lastName: s.teacher.user.userProfile?.lastName || 'N/A',
            email: s.teacher.user.email,
            courseName: s.teacher.courses.name,
          });
        }
      });
    });

    return Array.from(teachersMap.values());
}

  
  async getSchedule(userId: string): Promise<ScheduleDto[]> {
    const monitor = await this.prisma.getClient().monitor.findUnique({
      where: { userId },
      select: {
        classes: {
          select: {
            schedules: {
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
            },
          },
        },
      },
    });

    if (!monitor || !monitor.classes) {
      throw new NotFoundException('Monitor o clases no encontradas');
    }

    // Convertimos el objeto en un array antes de mapear
    const schedulesArray = Array.isArray(monitor.classes)
      ? monitor.classes
      : [monitor.classes];

    const schedules: ScheduleDto[] = schedulesArray.flatMap(clas =>
      clas.schedules.map(schedule => ({
        weekday: schedule.weekday as Weekday,
        startTime: schedule.hourSession.startTime,
        endTime: schedule.hourSession.endTime,
        courseName: schedule.teacher?.courses?.name || 'Sin asignar',
      })),
    );

    return schedules;
  }

  // ─────── Métodos auxiliares ───────

  private mapToMonitorDto(obj: any): MonitorBaseDto {
    return plainToInstance(MonitorBaseDto, obj);
  }
}
