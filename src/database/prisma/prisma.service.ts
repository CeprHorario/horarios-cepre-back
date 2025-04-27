import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaClientFactory } from './prisma-client.factory';
import { AsyncLocalStorage } from 'async_hooks';

import { initialDataSchema } from './data/seed';
import { ProcessAdmissionDto } from '@modules/admissions/dto/create-admission.dto';

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

  async migrationInitialSchema(
    schema: string,
    body: ProcessAdmissionDto,
  ): Promise<void> {
    //const client: PrismaClient = await this.setMainClient(schema);

    // Realizamos las migraciones iniciales
    await initialDataSchema(schema, body, this.getClient() /* client */);
  }
}
