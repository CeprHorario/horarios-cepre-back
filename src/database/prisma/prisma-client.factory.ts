import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import NodeCache from 'node-cache';
import { SchemaManagerService } from '../schema-manager/schema-manger.service';

export interface IPrismaClient {
  name: string;
  client: PrismaClient;
}

@Injectable()
export class PrismaClientFactory implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaClientFactory.name);
  private mainClient: IPrismaClient;
  private readonly cache: NodeCache;

  constructor(private readonly schemaManager: SchemaManagerService) {
    this.cache = new NodeCache({ stdTTL: 3600, checkperiod: 60 }); 

    // Configurar el evento para manejar la expiración de clientes en la caché
    this.cache.on('expired', (key, client: PrismaClient) => {
      this.logger.debug(
        `Prisma: client for schema ${key} expired from cache, disconnecting...`,
      );
      client
        .$disconnect()
        .then(() => {
          this.logger.debug(
            `Prisma: disconnected expired client for schema: ${key}`,
          );
        })
        .catch((error) => {
          this.logger.error(
            `Prisma: Error disconnecting expired client for schema ${key}: ${error}`,
          );
        });
    });
  }

  async onModuleInit() {
    try {
      const { name } = await this.schemaManager.getCurrent();
      this.mainClient = { name, client: this.createClient(name) };
      this.logger.debug(
        `Prisma: connected successfully for schema: ${this.mainClient.name}`,
      );
    } catch (error) {
      this.logger.error(`Prisma: Failed to connect to the database: ${error}`);
    }
  }

  getClient(schema: string): PrismaClient {
    if (schema === 'default') return this.mainClient.client;

    let client = this.cache.get(schema) as PrismaClient;

    if (!client) {
      this.logger.debug(`Prisma: creating client for schema: ${schema}`);
      client = this.createClient(schema);
      this.cache.set(schema, client);
    }

    return client;
  }

  async setMainClient(schema: string) {
    await this.mainClient.client.$disconnect();
    this.mainClient = {
      name: schema,
      client: this.createClient(schema),
    };
    return this.mainClient.client;
  }

  private createClient(schema: string): PrismaClient {
    return new PrismaClient({
      log: ['query'],
      datasources: {
        db: {
          url: `${process.env.DATABASE_URL}?schema=${schema}`,
        },
      },
    });
  }

  async onModuleDestroy() {
    this.logger.log('PrismaClientFactory: cleaning up resources...');

    // Cerrar cliente principal
    if (this.mainClient?.client) {
      await this.mainClient.client.$disconnect();
      this.logger.debug(
        `Prisma: disconnected main schema: ${this.mainClient.name}`,
      );
    }

    // Cerrar clientes en caché
    const keys = this.cache.keys();
    for (const schema of keys) {
      const client = this.cache.get(schema) as PrismaClient;
      if (client) {
        await client.$disconnect();
        this.logger.debug(`Prisma: disconnected cached schema: ${schema}`);
      }
    }

    this.cache.flushAll(); // Limpiar la caché
    this.logger.log('Prisma: all Prisma clients disconnected');
  }
}
