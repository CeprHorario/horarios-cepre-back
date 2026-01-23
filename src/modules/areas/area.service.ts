import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { CreateAreaDto, UpdateAreaDto, AreaBaseDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '@prisma/client';

@Injectable()
export class AreaService {
  constructor(private prisma: PrismaService) {}

  // ─────── CRUD ───────
  async create(createAreaDto: CreateAreaDto): Promise<AreaBaseDto> {
    const obj = await this.prisma.getClient().area.create({
      data: createAreaDto,
    });
    return this.mapToAreaDto(obj);
  }

  async findAll(): Promise<AreaBaseDto[]> {
    const objs = await this.prisma.getClient().area.findMany();
    return objs.map((obj) => this.mapToAreaDto(obj));
  }

  async findOne(id: number): Promise<AreaBaseDto> {
    const obj = await this.prisma
      .getClient()
      .area.findUnique({ where: { id } });
    if (!obj) {
      throw new NotFoundException(`Area with ID ${id} not found`);
    }
    return this.mapToAreaDto(obj);
  }

  async update(id: number, updateAreaDto: UpdateAreaDto): Promise<AreaBaseDto> {
    const obj = await this.prisma.getClient().area.update({
      where: { id },
      data: updateAreaDto,
    });
    return this.mapToAreaDto(obj);
  }

  async delete(id: number): Promise<AreaBaseDto> {
    try {
      const obj = await this.prisma.getClient().area.delete({
        where: { id },
      });
      return this.mapToAreaDto(obj);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'No se puede eliminar el área porque tiene cursos o relaciones asociadas.',
          );
        }
        if (error.code === 'P2025') {
          throw new NotFoundException('Área no encontrada.');
        }
      }
      throw new InternalServerErrorException('Error al eliminar el área.');
    }
  }

  // ─────── METODOS DE APOYO ───────
  private mapToAreaDto(obj: any): AreaBaseDto {
    return plainToInstance(AreaBaseDto, obj);
  }
}
