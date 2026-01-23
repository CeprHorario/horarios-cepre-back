import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { CreateSedeDto, UpdateSedeDto } from './dto/index';
import { Prisma } from '@prisma/client';
@Injectable()
export class SedeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateSedeDto) {
    try {
      return await this.prisma.getClient().sede.create({ data });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      throw new Error('Error al crear la sede');
    }
  }

  async findAll() {
    return this.prisma.getClient().sede.findMany();
  }

  async findOne(id: number) {
    const sede = await this.prisma
      .getClient()
      .sede.findUnique({ where: { id } });
    if (!sede) {
      throw new NotFoundException(`Sede con ID ${id} no encontrada`);
    }
    return sede;
  }

  async update(id: number, data: UpdateSedeDto) {
    try {
      return await this.prisma.getClient().sede.update({ where: { id }, data });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      throw new NotFoundException(
        `No se pudo actualizar, sede con ID ${id} no encontrada`,
      );
    }
  }

  async remove(id: number) {
    const sede = await this.prisma
      .getClient()
      .sede.findUnique({ where: { id } });
    if (!sede) {
      throw new NotFoundException(`Sede con ID ${id} no encontrada`);
    }
    try {
      return await this.prisma.getClient().sede.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'No se puede eliminar la sede porque tiene relaciones asociadas.',
          );
        }
      }
      throw new InternalServerErrorException('Error al eliminar la sede.');
    }
  }
}
