import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { ScheduleBaseDto, CreateScheduleDto, UpdateScheduleDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { LoadScheduleDto } from './dto';
import { Prisma, Weekday } from '@prisma/client';

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


  async assignTeacherToSchedules(
    classroomIds: string[], 
    teacherId: string 
  ) {
    const teacher = await this.prisma.getClient().teacher.findUnique({
      where: { id: teacherId },
      include: { schedules: true, courses: true }
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
      throw new Error('No hay horarios disponibles para este curso y estos salones');
    }
  
    const totalHoursToAdd = schedulesToAssign.length;
    const newTotalScheduledHours = scheduledHours + totalHoursToAdd;
  
    if (newTotalScheduledHours > maxHours) {
      throw new Error('El profesor no tiene suficiente capacidad para asumir estos horarios');
    }
  
    const updatedSchedules = await this.prisma.getClient().$transaction(async (prisma) => {
      const updatedSchedules = await prisma.schedule.updateMany({
        where: {
          id: { in: schedulesToAssign.map(schedule => schedule.id) }
        },
        data: { teacherId: teacher.id }
      });
  
      await prisma.teacher.update({
        where: { id: teacher.id },
        data: {
          scheduledHours: newTotalScheduledHours
        }
      });
  
      return updatedSchedules;
    });
  
    return updatedSchedules;
  }
  
  

  async findAvailableClassrooms(
    id_course: number,
    horario: Array<{ id_hour_session: number; weekday: Weekday }>,
    id_teacher?: string,
    page: number = 1,
    pageSize: number = 10
  ) {
    const allClassroomsInAreas = await this.prisma.getClient().class.findMany({
      where: {
        schedules: {
          some: {
            courseId: id_course, 
          },
        },
      },
      select: { id: true },
    });
  
    const allClassroomIds = allClassroomsInAreas.map((classroom) => classroom.id);
  
    if (allClassroomIds.length === 0) {
      return []; 
    }

    const conflictConditions: Prisma.ScheduleWhereInput[] = horario.flatMap((slot) => {
      const conditions: Prisma.ScheduleWhereInput[] = [
        {
          hourSessionId: slot.id_hour_session,
          weekday: slot.weekday,
          courseId: id_course,
          teacherId: null,  
        },
      ];
  
      if (id_teacher) {
        conditions.push({
          hourSessionId: slot.id_hour_session,
          weekday: slot.weekday,
          teacherId: id_teacher,
        });
      }
  
      return conditions;
    });
  
    const conflictingSchedules = await this.prisma.getClient().schedule.findMany({
      where: {
        classId: { in: allClassroomIds },
        OR: conflictConditions,
      },
      select: { classId: true },
    });
  
    const conflictingClassroomIds = conflictingSchedules.map((schedule) => schedule.classId);
    const startIndex = (page - 1) * pageSize;
    const paginatedClassroomIds = conflictingClassroomIds.slice(startIndex, startIndex + pageSize);
  

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
