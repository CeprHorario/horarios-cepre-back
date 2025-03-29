import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaClientFactory } from './prisma-client.factory';
import { AsyncLocalStorage } from 'async_hooks';

import {
  initialCourses,
  initialUsers,
  initalSedes,
  initialAreas,
} from 'prisma/data/seed-data-initial';

@Injectable()
export class PrismaService {
  constructor(
    private factory: PrismaClientFactory,
    private als: AsyncLocalStorage<{ schema: string }>,
  ) {}

  getClient(): PrismaClient {
    const schema = this.als.getStore()?.schema ?? 'default';
    return this.factory.getClient(schema);
  }

  async setMainClient(schema: string): Promise<PrismaClient> {
    return await this.factory.setMainClient(schema);
  }

  async migrationInitialSchema(schema: string): Promise<void> {
    const client: PrismaClient = await this.setMainClient(schema);
    // Realizamos las migraciones iniciales
    await client.$transaction([
      client.course.createMany({ data: initialCourses }),
      client.user.createMany({ data: initialUsers }),
      client.area.createMany({ data: initialAreas }),
      client.sede.createMany({ data: initalSedes }),
    ]);
  }
}
