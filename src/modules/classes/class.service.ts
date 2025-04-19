import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';

import {
  CreateClassDto,
  UpdateClassDto,
  ClassBaseDto,
  ClassForTeacherDto,
} from './dto';
import { plainToInstance } from 'class-transformer';
import { ScheduleForTeacherDto } from '@modules/schedules/dto';
import { HourSessionForTeacherDto } from '@modules/hour-session/dto';
import { AreaDto } from '@modules/areas/dto';
import { MonitorForTeacherDto } from '@modules/monitors/dto/monitorForTeacher.dto';
import { UserProfileForTeacherDto } from '@modules/user-profile/dto/user-profile-for-teacher.dto';
import { ScheduleForClass } from './dto/scheduleForClass.dto';

@Injectable()
export class ClassService {
  constructor(private prisma: PrismaService) {}

  // ─────── CRUD ───────
  async create(createClassDto: CreateClassDto): Promise<ClassBaseDto> {
    const obj = await this.prisma.getClient().class.create({
      data: createClassDto,
      include: { sede: true, area: true, shift: true, monitor: true },
    });
    return this.mapToClassDto(obj);
  }

  async findAll(): Promise<ClassBaseDto[]> {
    const classs = await this.prisma.getClient().class.findMany({
      include: { sede: true, area: true, shift: true, monitor: true },
    });
    return classs.map((clas) => this.mapToClassDto(clas));
  }

  async findOne(id: string): Promise<ClassBaseDto> {
    const obj = await this.prisma.getClient().class.findUnique({
      where: { id },
      include: { sede: true, area: true, shift: true, monitor: true },
    });
    if (!obj) {
      throw new NotFoundException(`Class with ID ${id} not found`);
    }
    return this.mapToClassDto(obj);
  }

  async update(
    id: string,
    updateClassDto: UpdateClassDto,
  ): Promise<ClassBaseDto> {
    const obj = await this.prisma.getClient().class.update({
      where: { id },
      data: updateClassDto,
      include: { sede: true, area: true, shift: true, monitor: true },
    });
    return this.mapToClassDto(obj);
  }

  async delete(id: string): Promise<ClassBaseDto> {
    const obj = await this.prisma.getClient().class.delete({
      where: { id },
      include: { sede: true, area: true, shift: true, monitor: true },
    });
    return this.mapToClassDto(obj);
  }

  // Metodo para mapear un objeto de tipo Class a un objeto de tipo ClassDto
  private mapToClassDto(obj: any): ClassBaseDto {
    return plainToInstance(ClassBaseDto, obj);
  }

  async findClassesOfTeacher(userId: string): Promise<ClassForTeacherDto[]> {
    const teacher = await this.prisma.getClient().teacher.findUnique({
      where: { userId: userId },
      select: { id: true },
    });

    if (!teacher) {
      throw new NotFoundException('Profesor no encontrado');
    }
    const classs = await this.prisma.getClient().class.findMany({
      where: {
        schedules: {
          some: {
            teacherId: teacher.id,
          },
        },
      },
      include: {
        area: true,
        shift: true,
        monitor: { include: { user: { include: { userProfile: true } } } },
        schedules: { include: { hourSession: true } },
      },
    });

    console.log('Datos obtenidos de la BD:', classs); // Debugging

    return classs.map((clas) =>
      plainToInstance(
        ClassForTeacherDto,
        {
          ...clas,
          area: clas.area
            ? plainToInstance(AreaDto, clas.area, {
                excludeExtraneousValues: true,
              })
            : null,
          monitor: clas.monitor
            ? plainToInstance(
                MonitorForTeacherDto,
                {
                  ...clas.monitor,
                  user: clas.monitor.user?.userProfile
                    ? plainToInstance(
                        UserProfileForTeacherDto,
                        clas.monitor.user.userProfile,
                        {
                          excludeExtraneousValues: true,
                        },
                      )
                    : null,
                },
                { excludeExtraneousValues: true },
              )
            : null,
          schedules: clas.schedules
            ? clas.schedules.map((s) =>
                plainToInstance(
                  ScheduleForTeacherDto,
                  {
                    ...s,
                    hourSession: s.hourSession
                      ? plainToInstance(
                          HourSessionForTeacherDto,
                          s.hourSession,
                          { excludeExtraneousValues: true },
                        )
                      : null,
                  },
                  { excludeExtraneousValues: true },
                ),
              )
            : [],
        },
        { excludeExtraneousValues: true },
      ),
    );
  }

  /**
   * Obtiene los horarios de una clase por su ID.
   * @param classId - ID de la clase
   * @returns - Lista de horarios de la clase
   * @throws NotFoundException - Si no se encuentran horarios para la clase
   */
  async getSchedulesByClassId(classId: string): Promise<ScheduleForClass[]> {
    const schedules = await this.prisma.getClient().schedule.findMany({
      where: { classId },
      select: {
        id: true,
        weekday: true,
        course: {
          select: { name: true },
        },
        hourSession: {
          select: {
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    if (!schedules) {
      throw new NotFoundException('No se encontraron horarios para esta clase');
    }

    return schedules.map((schedule) => ({
      id: schedule.id,
      weekDay: schedule.weekday,
      startTime: schedule.hourSession.startTime,
      endTime: schedule.hourSession.endTime,
      courseName: schedule.course.name,
    }));
  }
}
