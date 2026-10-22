import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { ScheduleBaseDto, CreateScheduleDto, UpdateScheduleDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { LoadScheduleDto } from './dto';
import { Weekday, Prisma } from '../../generated/prisma/client';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { covers, normalizeIntervals, overlaps, scheduleInterval } from './availability';
import { SaveAvailabilityDto } from './dto/availability.dto';

@Injectable()
export class ScheduleService {
  constructor(private prisma: PrismaService) {}

  async getAvailability(teacherId: string) {
    const teacher = await this.prisma.getClient().teacher.findFirst({ where: { id: teacherId, user: { isActive: true } } });
    if (!teacher) throw new NotFoundException('Docente no encontrado');
    const intervals = await this.prisma.getClient().teacherAvailability.findMany({
      where: { teacherId }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
    return intervals.map(({ weekday, startMinute, endMinute }) => ({
      weekday, start: this.formatMinute(startMinute), end: this.formatMinute(endMinute),
    }));
  }

  async saveAvailability(teacherId: string, data: SaveAvailabilityDto) {
    const minute = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
    const intervals = normalizeIntervals(data.intervals.map(({ weekday, start, end }) => {
      const startMinute = minute(start), endMinute = minute(end);
      if (startMinute >= endMinute) throw new BadRequestException('La hora de fin debe ser posterior a la de inicio');
      return { weekday, startMinute, endMinute };
    }));
    await this.assignmentTransaction(async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { id: teacherId, user: { isActive: true } } });
      if (!teacher) throw new NotFoundException('Docente no encontrado');
      await tx.teacherAvailability.deleteMany({ where: { teacherId } });
      if (intervals.length) await tx.teacherAvailability.createMany({ data: intervals.map((interval) => ({ teacherId, ...interval })) });
    });
    return intervals.map(({ weekday, startMinute, endMinute }) => ({ weekday, start: this.formatMinute(startMinute), end: this.formatMinute(endMinute) }));
  }

  private formatMinute(minute: number) {
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  }

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
    if (createScheduleDto.teacherId) throw new BadRequestException('Cree el bloque sin docente y use la asignación de salones para validar disponibilidad y cruces');
    const schedule = await this.prisma.getClient().schedule.create({
      data: createScheduleDto,
      include: { clas: true, hourSession: true, teacher: true },
    });
    return this.mapToScheduleDto(schedule);
  }

  async findAll(courseId?: number): Promise<ScheduleBaseDto[]> {
    const schedule = await this.prisma.getClient().schedule.findMany({
      where: courseId !== undefined ? { courseId } : undefined,
      include: { clas: true, hourSession: true, teacher: true },
    });
    return schedule.map((data) => this.mapToScheduleDto(data));
  }

  async findOne(id: number, courseId?: number): Promise<ScheduleBaseDto> {
    const schedule = await this.prisma.getClient().schedule.findFirst({
      where: {
        id,
        ...(courseId !== undefined && { courseId }),
      },
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
    if (updateScheduleDto.teacherId !== undefined) throw new BadRequestException('Use la asignación o desasignación de salones para cambiar el docente');
    const current = await this.prisma.getClient().schedule.findUnique({ where: { id } });
    if (current?.teacherId) throw new BadRequestException('Desasigne el docente antes de modificar este bloque de horario');
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
    return this.assignmentTransaction(async (prisma) => {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      include: { schedules: { include: { hourSession: true } }, courses: true, availabilities: true, user: true },
    });

    if (!teacher || !teacher.user.isActive) {
      throw new Error('Profesor no encontrado');
    }

    const { scheduledHours, maxHours, courseId } = teacher;

    if (maxHours === null || scheduledHours >= maxHours) {
      throw new Error('El profesor ha alcanzado su límite de horas');
    }

    const schedulesToAssign = await prisma.schedule.findMany({
      where: {
        classId: { in: classroomIds },
        courseId: courseId,
      },
      include: { hourSession: true },
    });

    if (new Set(schedulesToAssign.map((s) => s.classId)).size !== new Set(classroomIds).size || schedulesToAssign.some((s) => s.teacherId !== null)) {
      throw new BadRequestException('Todos los bloques del curso deben estar libres en los salones seleccionados');
    }

    if (schedulesToAssign.length === 0) {
      throw new Error(
        'No hay horarios disponibles para este curso y estos salones',
      );
    }

    const occupied = teacher.schedules.map(scheduleInterval);
    const requested = schedulesToAssign.map(scheduleInterval);
    for (const [index, interval] of requested.entries()) {
      if (!covers(teacher.availabilities, interval)) throw new BadRequestException('El horario está fuera de la disponibilidad del docente');
      if ([...occupied, ...requested.slice(0, index)].some((other) => overlaps(interval, other))) {
        throw new BadRequestException('El horario se cruza con otra clase del docente');
      }
    }

    const totalHoursToAdd = schedulesToAssign.length;
    const newTotalScheduledHours = scheduledHours + totalHoursToAdd;

    if (newTotalScheduledHours > maxHours) {
      throw new Error(
        'El profesor no tiene suficiente capacidad para asumir estos horarios',
      );
    }

        const updatedSchedules = await prisma.schedule.updateMany({
          where: {
            id: { in: schedulesToAssign.map((schedule) => schedule.id) },
            teacherId: null,
          },
          data: { teacherId: teacher.id },
        });

        await prisma.teacher.update({
          where: { id: teacher.id },
          data: {
            scheduledHours: { increment: updatedSchedules.count },
          },
        });

        return updatedSchedules;
      });
  }

  async unassignTeacherFromSchedules(
    classroomIds: string[],
    teacherId: string,
  ) {
    return this.assignmentTransaction(async (prisma) => {
    // Primero verificamos que el profesor exista
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
    });

    if (!teacher) {
      throw new Error('Profesor no encontrado');
    }

    // Obtenemos los horarios que coinciden con los IDs de clase y el profesor especificado
    const schedulesToUnassign = await prisma.schedule.findMany({
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
             currentTeacher.scheduledHours - updatedSchedules.count,
          );
          await prisma.teacher.update({
            where: { id: teacherId },
            data: { scheduledHours: newScheduledHours },
          });
        }

        return updatedSchedules;
      });
  }

  private async assignmentTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    // Ponytail: at most 3 retries under contention; use a queue if sustained contention requires more.
    for (let retry = 0; ; retry++) {
      try {
        return await this.prisma.getClient().$transaction(operation, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || retry >= 3) throw error;
      }
    }
  }

  async findAvailableClassrooms(
    id_course: number,
    horario: Array<{ id_hour_session: number; weekday: Weekday }>,
    page: number = 1,
    pageSize: number = 10,
    areaId?: number,
    shiftId?: number,
    teacherId?: string,
  ) {
    if (!teacherId) throw new BadRequestException('Se requiere el docente para consultar salones compatibles');
    const teacher = await this.prisma.getClient().teacher.findFirst({
      where: { id: teacherId, courseId: id_course, user: { isActive: true } },
      include: { availabilities: true, schedules: { include: { hourSession: true } } },
    });
    if (!teacher) throw new NotFoundException('Docente no encontrado para este curso');
    const occupied = teacher.schedules.map(scheduleInterval);
    const availableTimeSlots = new Set(
      horario.map((slot) => `${slot.id_hour_session}-${slot.weekday}`),
    );

    const classroomFilter: Prisma.ClassWhereInput = {
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
      },
      select: {
        id: true,
        classId: true,
        hourSessionId: true,
        weekday: true,
        hourSession: true,
        teacherId: true,
      },
    });

    const schedulesByClassroom = new Map<
      string,
      { hourSessionId: number; weekday: Weekday }[]
    >();
    const incompatibleClassrooms = new Set<string>();

    for (const schedule of courseSchedules) {
      const interval = scheduleInterval(schedule);
      if (schedule.teacherId !== null || !covers(teacher.availabilities, interval) || occupied.some((other) => overlaps(interval, other))) {
        incompatibleClassrooms.add(schedule.classId);
      }
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

      if (allSlotsAvailable && !incompatibleClassrooms.has(classId)) {
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
