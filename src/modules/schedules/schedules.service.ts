import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { ScheduleBaseDto, CreateScheduleDto, UpdateScheduleDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { LoadScheduleDto } from './dto';

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
  
  
}
