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
import {AreaDto} from "@modules/areas/dto";
import {MonitorForTeacherDto} from "@modules/monitors/dto/monitorForTeacher.dto";
import {UserProfileForTeacherDto} from "@modules/user-profile/dto/user-profile-for-teacher.dto";

@Injectable()
export class ClassService {
  constructor(private prisma: PrismaService) {}

  // ─────── CRUD ───────
  async create(createClassDto: CreateClassDto): Promise<ClassBaseDto> {
    const obj = await this.prisma.class.create({
      data: createClassDto,
      include: { sede: true, area: true, shift: true, monitor: true },
    });
    return this.mapToClassDto(obj);
  }

  async findAll(): Promise<ClassBaseDto[]> {
    const classs = await this.prisma.class.findMany({
      include: { sede: true, area: true, shift: true, monitor: true },
    });
    return classs.map((clas) => this.mapToClassDto(clas));
  }

  async findOne(id: string): Promise<ClassBaseDto> {
    const obj = await this.prisma.class.findUnique({
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
    const obj = await this.prisma.class.update({
      where: { id },
      data: updateClassDto,
      include: { sede: true, area: true, shift: true, monitor: true },
    });
    return this.mapToClassDto(obj);
  }

  async delete(id: string): Promise<ClassBaseDto> {
    const obj = await this.prisma.class.delete({
      where: { id },
      include: { sede: true, area: true, shift: true, monitor: true },
    });
    return this.mapToClassDto(obj);
  }

  // Metodo para mapear un objeto de tipo Class a un objeto de tipo ClassDto
  private mapToClassDto(obj: any): ClassBaseDto {
    return plainToInstance(ClassBaseDto, obj);
  }

  async findAllTest(): Promise<ClassForTeacherDto[]> {
    const classs = await this.prisma.class.findMany({
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
}
