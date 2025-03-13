import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/db/prisma/prisma.service';
import { /*Area, AreaCourseHour,*/ Prisma } from '@prisma/client';

@Injectable()
export class AcademicService {
  constructor(private prisma: PrismaService) {}

  // ─────── AREA CRUD ───────
  createArea(data: Prisma.AreaCreateInput) {
    return this.prisma.area.create({ data });
  }

  findAllAreas(params: Prisma.AreaFindManyArgs = {}) {
    return this.prisma.area.findMany(params);
  }

  findOneArea(id: number) {
    return this.prisma.area.findUnique({ where: { id } });
  }

  updateArea(id: number, data: Prisma.AreaUpdateInput) {
    return this.prisma.area.update({ where: { id }, data });
  }

  deleteArea(id: number) {
    return this.prisma.area.delete({ where: { id } });
  }

  // ─────── AREA COURSE HOUR CRUD ───────
  createAreaCourseHour(data: Prisma.AreaCourseHourCreateInput) {
    return this.prisma.areaCourseHour.create({ data });
  }

  findAllAreaCourseHours(params: Prisma.AreaCourseHourFindManyArgs = {}) {
    return this.prisma.areaCourseHour.findMany(params);
  }

  findOneAreaCourseHour(id: number) {
    return this.prisma.areaCourseHour.findUnique({ where: { id } });
  }

  updateAreaCourseHour(id: number, data: Prisma.AreaCourseHourUpdateInput) {
    return this.prisma.areaCourseHour.update({ where: { id }, data });
  }

  deleteAreaCourseHour(id: number) {
    return this.prisma.areaCourseHour.delete({ where: { id } });
  }
}
