import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
//Si algun dia borran el domingo para que sea mas mantenible este codigo xd
//import { Weekday } from '@prisma/client'; // Importamos el enum Weekday

const WEEKDAYS_COUNT = 6;

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
import { TeacherResponseDto } from '@modules/monitors/dto/teacher-response.dto';

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
    const classes = await this.prisma.getClient().class.findMany({
      include: {
        sede: true,
        area: true,
        monitor: true,
        schedules: true,
        // Incluimos la relación shift con hourSession para calcular el número total de períodos
        shift: {
          include: {
            hourSessions: true,
          },
        },
      },
    });

    const classesWithStatus = await Promise.all(
      classes.map(async (clas) => {
        // Para cada clase, calculamos el número esperado de horarios
        const totalPeriods = clas.shift?.hourSessions?.length || 0;
        const expectedSchedulesCount = totalPeriods * WEEKDAYS_COUNT;

        // Verificamos que existan todos los registros de horarios esperados
        const totalSchedules = clas.schedules?.length || 0;

        // Contamos los horarios asignados con profesor
        const schedulesWithTeacherCount =
          clas.schedules?.filter((s) => s.teacherId !== null)?.length || 0;

        // Determinamos el estado:
        // - Si hay menos registros que los esperados: FALTAN_REGISTROS
        // - Si hay suficientes registros pero faltan profesores: FALTAN_DOCENTES
        // - Si todos los horarios tienen profesor asignado: COMPLETO
        let status = 'FALTAN_DOCENTES';
        if (totalSchedules < expectedSchedulesCount) {
          status = 'FALTAN_REGISTROS';
        } else if (
          schedulesWithTeacherCount === expectedSchedulesCount &&
          expectedSchedulesCount > 0
        ) {
          status = 'COMPLETO';
        }

        // Creamos un nuevo objeto sin incluir schedules ni hourSessions
        const classWithoutSchedules = {
          ...clas,
          status,
          schedules: undefined,
          shift: {
            ...clas.shift,
            hourSessions: undefined,
          },
        };

        return classWithoutSchedules;
      }),
    );

    return classesWithStatus.map((clas) => this.mapToClassDto(clas));
  }

  async findOne(id: string): Promise<ClassBaseDto> {
    const obj = await this.prisma.getClient().class.findUnique({
      where: { id },
      include: {
        sede: true,
        area: true,
        shift: {
          include: {
            hourSessions: true,
          },
        },
        monitor: true,
        schedules: true,
      },
    });

    if (!obj) {
      throw new NotFoundException(`Class with ID ${id} not found`);
    }

    // Calculamos el número esperado de horarios
    const totalPeriods = obj.shift?.hourSessions?.length || 0;
    const expectedSchedulesCount = totalPeriods * WEEKDAYS_COUNT;

    // Verificamos que existan todos los registros de horarios esperados
    const totalSchedules = obj.schedules?.length || 0;

    // Contamos los horarios asignados con profesor
    const schedulesWithTeacherCount =
      obj.schedules?.filter((s) => s.teacherId !== null)?.length || 0;

    // Determinamos el estado:
    // - Si hay menos registros que los esperados: FALTAN_REGISTROS
    // - Si hay suficientes registros pero faltan profesores: FALTAN_DOCENTES
    // - Si todos los horarios tienen profesor asignado: COMPLETO
    let status = 'FALTAN_DOCENTES';
    if (totalSchedules < expectedSchedulesCount) {
      status = 'FALTAN_REGISTROS';
    } else if (
      schedulesWithTeacherCount === expectedSchedulesCount &&
      expectedSchedulesCount > 0
    ) {
      status = 'COMPLETO';
    }

    // Creamos un nuevo objeto sin incluir schedules ni hourSessions
    const objWithoutSchedules = {
      ...obj,
      status,
      schedules: undefined,
      shift: {
        ...obj.shift,
        hourSessions: undefined,
      },
    };

    return this.mapToClassDto(objWithoutSchedules);
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
    return plainToInstance(ClassBaseDto, {
      ...obj,
      // Aseguramos que el estado se mantenga en la transformación
      status: obj.status || 'FALTAN_DOCENTES',
    });
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

  async getTeachersByClassId(classId: string): Promise<TeacherResponseDto[]> {
    const teachers = await this.prisma.getClient().schedule.findMany({
      distinct: ['teacherId'],
      where: { classId },
      select: {
        teacher: {
          select: {
            id: true,
            user: {
              select: {
                userProfile: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
                email: true,
              },
            },
          },
        },
        course: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!teachers) {
      throw new NotFoundException('No se encontraron docentes para esta clase');
    }
    return teachers.map((teacher) => ({
      teacherId: teacher.teacher?.id || 'no asignado',
      firstName: teacher.teacher?.user?.userProfile?.firstName || 'no asignado',
      lastName: teacher.teacher?.user?.userProfile?.lastName || 'no asignado',
      email: teacher.teacher?.user.email || 'no asignado',
      courseName: teacher.course.name || 'no asignado',
    }));
  }

  async updateMeetLink(id: string, urlMeet: string) {
    try {
      const classObj = await this.prisma.getClient().class.findUnique({
        where: { id },
      });

      if (!classObj) {
        throw new NotFoundException(`Clase con ID ${id} no encontrada`);
      }

      const updatedClass = await this.prisma.getClient().class.update({
        where: { id },
        data: { urlMeet },
        select: {
          id: true,
          name: true,
          urlMeet: true,
        },
      });

      return {
        message: 'Enlace de Meet actualizado correctamente',
        class: updatedClass,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Error al actualizar enlace de Meet:', error);
      throw new BadRequestException('Error al actualizar el enlace de Meet');
    }
  }

  async updateClassroomLink(id: string, urlClassroom: string) {
    try {
      const classObj = await this.prisma.getClient().class.findUnique({
        where: { id },
      });

      if (!classObj) {
        throw new NotFoundException(`Clase con ID ${id} no encontrada`);
      }

      const updatedClass = await this.prisma.getClient().class.update({
        where: { id },
        data: { urlClassroom },
        select: {
          id: true,
          name: true,
          urlClassroom: true,
        },
      });

      return {
        message: 'Enlace de Classroom actualizado correctamente',
        class: updatedClass,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Error al actualizar enlace de Classroom:', error);
      throw new BadRequestException(
        'Error al actualizar el enlace de Classroom',
      );
    }
  }
}
