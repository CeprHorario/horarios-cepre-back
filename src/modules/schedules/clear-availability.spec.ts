import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '@database/prisma/prisma.service';
import { ScheduleService } from './schedules.service';
import { ClearAvailabilityDto } from './dto/availability.dto';

describe('Quitar disponibilidad múltiple', () => {
  it('borra en una operación de conjunto y conserva horarios', async () => {
    const tx = {
      teacher: {
        findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
      },
      teacherAvailability: {
        deleteMany: jest.fn().mockResolvedValue({ count: 7 }),
      },
    };
    const transaction = jest.fn(
      async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    );
    const service = new ScheduleService({
      getClient: () => ({ $transaction: transaction }),
    } as unknown as PrismaService);
    expect(await service.clearAvailability(['a', 'b'])).toEqual({
      teachers: 2,
      intervals: 7,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.teacherAvailability.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.teacherAvailability.deleteMany).toHaveBeenCalledWith({
      where: { teacherId: { in: ['a', 'b'] } },
    });
  });

  it('rechaza todo el lote antes de borrar si falta un docente activo', async () => {
    const tx = {
      teacher: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }]) },
      teacherAvailability: { deleteMany: jest.fn() },
    };
    const service = new ScheduleService({
      getClient: () => ({
        $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
          work(tx),
      }),
    } as unknown as PrismaService);
    await expect(service.clearAvailability(['a', 'missing'])).rejects.toThrow(
      'no existen',
    );
    expect(tx.teacherAvailability.deleteMany).not.toHaveBeenCalled();
  });

  it('valida selección no vacía, única y limitada con UUID válidos', async () => {
    const id = '019a2100-0000-7000-8000-000000000001';
    expect(
      await validate(
        plainToInstance(ClearAvailabilityDto, { teacherIds: [id] }),
      ),
    ).toHaveLength(0);
    for (const teacherIds of [[], [id, id], ['invalid'], Array(501).fill(id)])
      expect(
        await validate(plainToInstance(ClearAvailabilityDto, { teacherIds })),
      ).not.toHaveLength(0);
  });
});
