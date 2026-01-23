import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { CreateShiftDto, UpdateShiftDto } from './dto/index';
import { CreateHourSessionDto } from '@modules/hour-session/dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ShiftService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateShiftDto) {
    // Validar que las horas sean válidas y cumplan con la condición de bloques de 45 minutos
    const { startTime, endTime, name } = this.validateShiftTimes(data);

    return await this.prisma.getClient().$transaction(async (tx) => {
      const shift = await tx.shift.create({
        data: { name, startTime, endTime },
      });

      const hourSessionData: CreateHourSessionDto[] = [];
      const sessionDuration = 40 * 60 * 1000; // 40 minutes in milliseconds
      const breakDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
      let current = new Date(startTime);

      for (let i = 1; current < endTime; i++) {
        const sessionEnd = new Date(current.getTime() + sessionDuration);
        hourSessionData.push({
          shiftId: shift.id,
          period: i,
          startTime: current.toISOString(),
          endTime: sessionEnd.toISOString(),
        });
        current = new Date(sessionEnd.getTime() + breakDuration);
      }

      await tx.hourSession.createMany({
        data: hourSessionData,
      });
      return shift;
    });
  }
  private validateShiftTimes(data: CreateShiftDto) {
    const today = new Date().toISOString().split('T')[0];
    const startTime = new Date(`${today}T${data.startTime}Z`);
    const endTime = new Date(`${today}T${data.endTime}Z`);

    if (endTime <= startTime) {
      throw new BadRequestException('Shift: end time must be after start time');
    }

    const diffMinutes =
      (endTime.getTime() - startTime.getTime() + 300000) / (1000 * 60);
    if (diffMinutes % 45 !== 0) {
      throw new BadRequestException('Shift: invalid time difference');
    }

    return { startTime, endTime, name: data.name };
  }

  async findAll() {
    return await this.prisma.getClient().shift.findMany();
  }

  async findOne(id: number) {
    const shift = await this.prisma.getClient().shift.findUnique({
      where: { id },
    });
    if (!shift) {
      throw new NotFoundException(`Turno con ID ${id} no encontrado.`);
    }
    return shift;
  }

  async update(id: number, data: UpdateShiftDto) {
    try {
      const existingShift = await this.prisma.getClient().shift.findUnique({
        where: { id },
      });
      if (!existingShift) {
        throw new NotFoundException(`Turno con ID ${id} no encontrado.`);
      }

      const today = new Date().toISOString().split('T')[0];

      return await this.prisma.getClient().shift.update({
        where: { id },
        data: {
          name: data.name ?? existingShift.name,
          startTime: data.startTime
            ? new Date(`${today}T${data.startTime}Z`).toISOString()
            : existingShift.startTime,
          endTime: data.endTime
            ? new Date(`${today}T${data.endTime}Z`).toISOString()
            : existingShift.endTime,
        },
      });
    } catch (error) {
      throw new BadRequestException(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        'Error al actualizar el turno: ' + error.message,
      );
    }
  }

  async remove(id: number) {
    try {
      const shift = await this.prisma
        .getClient()
        .shift.findUnique({ where: { id } });
      if (!shift) {
        throw new NotFoundException(`Turno con ID ${id} no encontrado.`);
      }

      return await this.prisma.getClient().shift.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'No se puede eliminar el turno porque tiene horarios o clases asociadas.',
          );
        }
      }
      throw new BadRequestException(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        'Error al eliminar el turno: ' + error.message,
      );
    }
  }
}
