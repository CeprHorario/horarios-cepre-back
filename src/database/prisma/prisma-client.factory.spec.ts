import { PrismaClientFactory } from './prisma-client.factory';

describe('PrismaClientFactory', () => {
  it('returns the same PrismaClient instance for the same schema', async () => {
    const schemaManager = { getCurrent: jest.fn() };
    const factory = new PrismaClientFactory(schemaManager as never);

    const firstClient = factory.getClient('admission_2026');
    const secondClient = factory.getClient('admission_2026');

    expect(secondClient).toBe(firstClient);

    await factory.onModuleDestroy();
  });

  it('keeps separate PrismaClient instances for different schemas', async () => {
    const schemaManager = { getCurrent: jest.fn() };
    const factory = new PrismaClientFactory(schemaManager as never);

    const firstClient = factory.getClient('admission_2025');
    const secondClient = factory.getClient('admission_2026');

    expect(secondClient).not.toBe(firstClient);

    await factory.onModuleDestroy();
  });
});
