import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { CreateHourSessionDto, UpdateHourSessionDto } from './dto/index';

@Injectable()
export class HourSessionService {
  constructor(private readonly prisma: PrismaService) {}

  private calculateDuration(startTime: string, endTime: string): number {
    const start = new Date(`1970-01-01T${startTime}Z`);
    const end = new Date(`1970-01-01T${endTime}Z`);
    console.log('start', start);
    console.log('end', end);
    return (end.getTime() - start.getTime()) / 60000; // Duración en minutos
  }

  async create(data: CreateHourSessionDto) {
    try {
      const today = new Date().toISOString().split('T')[0]; // Obtiene la fecha actual (YYYY-MM-DD)
      const durationMinutes = this.calculateDuration(
        data.startTime,
        data.endTime,
      );
      return await this.prisma.getClient().hourSession.create({
        data: {
          shiftId: data.shiftId,
          period: data.period,
          startTime: new Date(`${today}T${data.startTime}Z`).toISOString(),
          endTime: new Date(`${today}T${data.endTime}Z`).toISOString(),
          durationMinutes,
        },
      });
    } catch (error) {
      throw new HttpException(
         
        `Error al crear la sesión: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findAll() {
    try {
      return await this.prisma.getClient().hourSession.findMany({
        include: { shift: true },
      });
    } catch (error) {
      throw new HttpException(
         
        `Error al obtener las sesiones: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(id: number) {
    try {
      const session = await this.prisma.getClient().hourSession.findUnique({
        where: { id },
        include: { shift: true },
      });
      if (!session) {
        throw new HttpException('Sesión no encontrada', HttpStatus.NOT_FOUND);
      }
      return session;
    } catch (error) {
      throw new HttpException(
         
        `Error al buscar la sesión: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async update(id: number, data: UpdateHourSessionDto) {
    try {
      // Verificar si la sesión existe
      const existingSession = await this.prisma
        .getClient()
        .hourSession.findUnique({
          where: { id },
        });

      if (!existingSession) {
        throw new HttpException('Sesión no encontrada', HttpStatus.NOT_FOUND);
      }

      const today = new Date().toISOString().split('T')[0];
      const durationMinutes = this.calculateDuration(
        data.startTime,
        data.endTime,
      );

      return await this.prisma.getClient().hourSession.update({
        where: { id },
        data: {
          shiftId: data.shiftId,
          period: data.period,
          startTime: new Date(`${today}T${data.startTime}Z`).toISOString(),
          endTime: new Date(`${today}T${data.endTime}Z`).toISOString(),
          durationMinutes,
        },
      });
    } catch (error) {
      throw new HttpException(
         
        `Error al actualizar la sesión: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma
        .getClient()
        .hourSession.delete({ where: { id } });
    } catch (error) {
      throw new HttpException(
         
        `Error al eliminar la sesión: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
