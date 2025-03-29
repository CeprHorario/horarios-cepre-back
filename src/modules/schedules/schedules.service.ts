import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { ScheduleBaseDto, CreateScheduleDto, UpdateScheduleDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { LoadScheduleDto } from './dto';

@Injectable()
export class ScheduleService {
  constructor(private prisma: PrismaService) {}

  async loadWithCourses(data: LoadScheduleDto) {
    const { salon, courses, shift } = await this.getData(
      data.salon,
      data.turno,
    );
    if (!salon) {
      throw new NotFoundException(`Salon ${data.salon} no encontrado`);
    }
    if (!shift) {
      throw new NotFoundException(`Turno ${data.turno} no encontrado`);
    }
    const bloques = shift.hourSessions;

    const schedules: CreateScheduleDto[] = [];

    data.horarios.map((horario) => {
      horario.clases.map((clase) => {
        const bloque = bloques.find((bloque) => bloque.period === clase.bloque);
        if (!bloque) {
          throw new NotFoundException(`Bloque ${clase.bloque} no encontrado`);
        }
        const course = courses.find((course) => course.name === clase.curso);
        if (!course) {
          throw new NotFoundException(`Curso ${clase.curso} no encontrado`);
        }
        schedules.push({
          classId: salon[0].id,
          courseId: course.id,
          hourSessionId: bloque.id,
          weekday: horario.dia, // Assuming `clase.weekday` exists and provides the required value
        });
      });
    });

    return this.prisma.getClient().schedule.createMany({
      data: schedules,
      skipDuplicates: true,
    });
  }

  private async getData(nameClass: string, turno: string) {
    const client = this.prisma.getClient();
    const [salon, courses, shift] = await client.$transaction([
      client.class.findMany({
        select: { id: true, name: true },
        where: { name: nameClass },
      }),
      client.course.findMany({ select: { id: true, name: true } }),
      client.shift.findFirst({
        include: { hourSessions: { select: { id: true, period: true } } },
        where: { name: { contains: turno } },
      }),
    ]);
    return { salon, courses, shift };
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
}
