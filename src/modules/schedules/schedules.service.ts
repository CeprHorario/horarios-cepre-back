import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { ScheduleBaseDto, CreateScheduleDto, UpdateScheduleDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { LoadScheduleDto } from './dto';
import { Prisma, Weekday } from '@prisma/client';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { Weekday } from '@prisma/client';


@Injectable()
export class ScheduleService {
  constructor(private prisma: PrismaService) {}

  async loadWithCourses(data: LoadScheduleDto) {
    const courses = await this.prisma
      .getClient()
      .course.findMany({ select: { id: true, name: true } });
    const hourSessions = await this.prisma
      .getClient()
      .hourSession.findMany({ select: { id: true, period: true } });

    const result = {
      courses,
      hourSessions,
    };
    console.log(result);
    return data;
  }

  async getPublicScheduleByTeacher(email: string, dni: string) {
    console.log('email', email);
    console.log('dni', dni);
    if (!(email && dni)) {
      throw new NotFoundException('Se debe proporcionar un email o un DNI');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmailValid = email ? emailRegex.test(email) : false;
    const isDniValid = dni ? dni.length >= 8 : false;
    if (!(isEmailValid && isDniValid)) {
      throw new BadRequestException(
        'Se debe proporcionar un email válido o un DNI con al menos 8 caracteres',
      );
    }
    const user = await this.prisma.getClient().user.findFirst({
      where: {
        AND: [
          { email, role: Role.TEACHER, isActive: true },
          { userProfile: { dni } },
        ],
      },
      select: {
        teacher: {
          select: {
            courses: {
              select: { name: true },
            },
            schedules: {
              select: {
                clas: {
                  select: { name: true, shift: { select: { name: true } } },
                },
                weekday: true,
                hourSession: { select: { startTime: true, endTime: true } },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Profesor no encontrado');
    }
    const parsedHoraMinutoUTC = (value: string | Date): string => {
      const date = new Date(value);
      const hours = String(date.getUTCHours()).padStart(2, '0');
      const minutes = String(date.getUTCMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    };

    return {
      curso: user?.teacher?.courses.name,
      horarios: user?.teacher?.schedules.map((schedule) => {
        return {
          turno: schedule.clas.shift.name,
          dia: schedule.weekday,
          clase: schedule.clas.name,
          hora_inicio: parsedHoraMinutoUTC(schedule.hourSession.startTime),
          hora_fin: parsedHoraMinutoUTC(schedule.hourSession.endTime),
        };
      }),
    };
  }

  // ─────── CRUD ───────
  async create(createScheduleDto: CreateScheduleDto): Promise<ScheduleBaseDto> {
    const schedule = await this.prisma.getClient().schedule.create({
      data: createScheduleDto,
      include: { clas: true, hourSession: true, teacher: true },
    });
    return this.mapToScheduleDto(schedule);
  }

  async findAll(): Promise<ScheduleBaseDto[]> {
    const schedule = await this.prisma.getClient().schedule.findMany({
      include: { clas: true, hourSession: true, teacher: true },
    });
    return schedule.map((data) => this.mapToScheduleDto(data));
  }

  async findOne(id: number): Promise<ScheduleBaseDto> {
    const schedule = await this.prisma.getClient().schedule.findUnique({
      where: { id },
      include: { clas: true, hourSession: true, teacher: true },
    });
    if (!schedule) {
      throw new NotFoundException(`Schedule with ID ${id} not found`);
    }
    return this.mapToScheduleDto(schedule);
  }

  async update(
    id: number,
    updateScheduleDto: UpdateScheduleDto,
  ): Promise<ScheduleBaseDto> {
    const schedule = await this.prisma.getClient().schedule.update({
      where: { id },
      data: updateScheduleDto,
      include: { clas: true, hourSession: true, teacher: true },
    });
    return this.mapToScheduleDto(schedule);
  }

  async delete(id: number): Promise<ScheduleBaseDto> {
    const schedule = await this.prisma.getClient().schedule.delete({
      where: { id },
      include: { clas: true, hourSession: true, teacher: true },
    });
    return this.mapToScheduleDto(schedule);
  }

  // Metodo para mapear un objeto de tipo Schedule a un objeto de tipo ScheduleDto
  private mapToScheduleDto(obj: any): ScheduleBaseDto {
    return plainToInstance(ScheduleBaseDto, obj);
  }

  async assignTeacherToSchedules(classroomIds: string[], teacherId: string) {
    const teacher = await this.prisma.getClient().teacher.findUnique({
      where: { id: teacherId },
      include: { schedules: true, courses: true },
    });

    if (!teacher) {
      throw new Error('Profesor no encontrado');
    }

    const { scheduledHours, maxHours, courseId } = teacher;

    if (maxHours === null || scheduledHours >= maxHours) {
      throw new Error('El profesor ha alcanzado su límite de horas');
    }

    const schedulesToAssign = await this.prisma.getClient().schedule.findMany({
      where: {
        classId: { in: classroomIds },
        courseId: courseId,
        teacherId: null,
      },
    });

    if (schedulesToAssign.length === 0) {
      throw new Error(
        'No hay horarios disponibles para este curso y estos salones',
      );
    }

    const totalHoursToAdd = schedulesToAssign.length;
    const newTotalScheduledHours = scheduledHours + totalHoursToAdd;

    if (newTotalScheduledHours > maxHours) {
      throw new Error(
        'El profesor no tiene suficiente capacidad para asumir estos horarios',
      );
    }

    const updatedSchedules = await this.prisma
      .getClient()
      .$transaction(async (prisma) => {
        const updatedSchedules = await prisma.schedule.updateMany({
          where: {
            id: { in: schedulesToAssign.map((schedule) => schedule.id) },
          },
          data: { teacherId: teacher.id },
        });

        await prisma.teacher.update({
          where: { id: teacher.id },
          data: {
            scheduledHours: newTotalScheduledHours,
          },
        });

        return updatedSchedules;
      });

    return updatedSchedules;
  }

  async unassignTeacherFromSchedules(
    classroomIds: string[],
    teacherId: string,
  ) {
    // Primero verificamos que el profesor exista
    const teacher = await this.prisma.getClient().teacher.findUnique({
      where: { id: teacherId },
    });

    if (!teacher) {
      throw new Error('Profesor no encontrado');
    }

    // Obtenemos los horarios que coinciden con los IDs de clase y el profesor especificado
    const schedulesToUnassign = await this.prisma
      .getClient()
      .schedule.findMany({
        where: {
          classId: { in: classroomIds },
          teacherId: teacherId, // Solo los horarios del profesor especificado
        },
      });

    if (schedulesToUnassign.length === 0) {
      throw new Error(
        'No hay horarios asignados a este profesor en los salones especificados',
      );
    }

    const totalHoursToRemove = schedulesToUnassign.length;

    // Realizamos las actualizaciones en una transacción
    const updatedSchedules = await this.prisma
      .getClient()
      .$transaction(async (prisma) => {
        // Actualizamos los horarios para quitar el profesor
        const updatedSchedules = await prisma.schedule.updateMany({
          where: {
            id: { in: schedulesToUnassign.map((schedule) => schedule.id) },
            teacherId: teacherId, // Aseguramos que solo se desasignen los del profesor indicado
          },
          data: { teacherId: null },
        });

        // Actualizamos las horas programadas del profesor
        const currentTeacher = await prisma.teacher.findUnique({
          where: { id: teacherId },
          select: { scheduledHours: true },
        });

        if (currentTeacher) {
          const newScheduledHours = Math.max(
            0,
            currentTeacher.scheduledHours - totalHoursToRemove,
          );
          await prisma.teacher.update({
            where: { id: teacherId },
            data: { scheduledHours: newScheduledHours },
          });
        }

        return updatedSchedules;
      });

    return updatedSchedules;
  }

  async findAvailableClassrooms(
    id_course: number,
    horario: Array<{ id_hour_session: number; weekday: Weekday }>,
    page: number = 1,
    pageSize: number = 10,
    areaId?: number,
    shiftId?: number,
  ) {
    const availableTimeSlots = new Set(
      horario.map((slot) => `${slot.id_hour_session}-${slot.weekday}`),
    );

    const classroomFilter: any = {
      schedules: {
        some: {
          courseId: id_course,
        },
      },
      ...(areaId ? { areaId } : {}),
      ...(shiftId ? { shiftId } : {}),
    };

    const allClassroomsInAreas = await this.prisma.getClient().class.findMany({
      where: classroomFilter,
      select: { id: true },
    });

    const allClassroomIds = allClassroomsInAreas.map((c) => c.id);

    if (allClassroomIds.length === 0) {
      return [];
    }

    const courseSchedules = await this.prisma.getClient().schedule.findMany({
      where: {
        classId: { in: allClassroomIds },
        courseId: id_course,
        teacherId: null,
      },
      select: {
        id: true,
        classId: true,
        hourSessionId: true,
        weekday: true,
      },
    });

    const schedulesByClassroom = new Map<
      string,
      { hourSessionId: number; weekday: Weekday }[]
    >();

    for (const schedule of courseSchedules) {
      if (!schedulesByClassroom.has(schedule.classId)) {
        schedulesByClassroom.set(schedule.classId, []);
      }
      schedulesByClassroom.get(schedule.classId)!.push({
        hourSessionId: schedule.hourSessionId,
        weekday: schedule.weekday,
      });
    }

    const matchingClassroomIds: string[] = [];

    for (const [classId, slots] of schedulesByClassroom.entries()) {
      const allSlotsAvailable = slots.every((slot) =>
        availableTimeSlots.has(`${slot.hourSessionId}-${slot.weekday}`),
      );

      if (allSlotsAvailable) {
        matchingClassroomIds.push(classId);
      }
    }

    const startIndex = (page - 1) * pageSize;
    const paginatedClassroomIds = matchingClassroomIds.slice(
      startIndex,
      startIndex + pageSize,
    );

    if (paginatedClassroomIds.length === 0) {
      return [];
    }

    const classrooms = await this.prisma.getClient().class.findMany({
      where: {
        id: { in: paginatedClassroomIds },
      },
      include: {
        sede: true,
        shift: true,
        schedules: {
          where: {
            courseId: id_course,
            teacherId: null,
          },
          select: {
            hourSession: {
              select: {
                id: true,
                startTime: true,
                endTime: true,
              },
            },
            weekday: true,
          },
        },
      },
    });

    return classrooms;
  }
}
