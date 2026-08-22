import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
//import { /*Area, AreaCourseHour, Prisma */} from '@prisma/client';

import {
  CreateAreaCourseHourDto,
  UpdateAreaCourseHourDto,
  AreaCourseHourBaseDto,
} from './dto';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class AreaCourseHourService {
  constructor(private prisma: PrismaService) {}

  // ─────── CRUD ───────
  async create(
    createAreaCourseHourDto: CreateAreaCourseHourDto,
  ): Promise<AreaCourseHourBaseDto> {
    const obj = await this.prisma.getClient().areaCourseHour.create({
      data: createAreaCourseHourDto,
      include: { area: true, course: true },
    });
    return this.mapToAreaCourseHourDto(obj);
  }

  async findAll(courseId?: number): Promise<AreaCourseHourBaseDto[]> {
    const objs = await this.prisma.getClient().areaCourseHour.findMany({
      where: courseId !== undefined ? { courseId } : undefined,
      include: { area: true, course: true },
    });
    return objs.map((data) => this.mapToAreaCourseHourDto(data));
  }

  async findOne(id: number, courseId?: number): Promise<AreaCourseHourBaseDto> {
    const obj = await this.prisma.getClient().areaCourseHour.findFirst({
      where: {
        id,
        ...(courseId !== undefined && { courseId }),
      },
      include: { area: true, course: true },
    });
    if (!obj) {
      throw new NotFoundException(`Area with ID ${id} not found`);
    }
    return this.mapToAreaCourseHourDto(obj);
  }

  async update(
    id: number,
    updateAreaCourseHourDto: UpdateAreaCourseHourDto,
  ): Promise<AreaCourseHourBaseDto> {
    const obj = await this.prisma.getClient().areaCourseHour.update({
      where: { id },
      include: { area: true, course: true },
      data: updateAreaCourseHourDto,
    });
    return this.mapToAreaCourseHourDto(obj);
  }

  async delete(id: number): Promise<AreaCourseHourBaseDto> {
    const obj = await this.prisma.getClient().areaCourseHour.delete({
      where: { id },
    });
    return this.mapToAreaCourseHourDto(obj);
  }

  // ─────── METODOS DE APOYO ───────
  private mapToAreaCourseHourDto(obj: any): AreaCourseHourBaseDto {
    return plainToInstance(AreaCourseHourBaseDto, obj);
  }
}
