import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SchemaManagerService } from '../schema-manager/schema-manger.service';

export interface IPrismaClient {
  name: string;
  client: PrismaClient;
}

@Injectable()
export class PrismaClientFactory implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaClientFactory.name);
  private mainClient: IPrismaClient;
  private readonly clients = new Map<string, PrismaClient>();

  constructor(private readonly schemaManager: SchemaManagerService) {}

  async onModuleInit() {
    try {
      const { name } = await this.schemaManager.getCurrent();
      await this.setMainClient(name);
      this.logger.debug(
        `Prisma: connected successfully for schema: ${this.mainClient.name}`,
      );
    } catch (error) {
      this.logger.error(`Prisma: Failed to connect to the database: ${error}`);
    }
  }

  getClient(schema: string): PrismaClient {
    if (schema === 'default') return this.mainClient.client;

    let client = this.clients.get(schema);

    if (!client) {
      this.logger.debug(`Prisma: creating client for schema: ${schema}`);
      client = this.createClient(schema);
      this.clients.set(schema, client);
    }

    return client;
  }

  async setMainClient(schema: string) {
    if (this.mainClient) await this.mainClient.client.$disconnect();

    const limitConnections = this.isDev() ? 4 : 30;
    const timeOut = this.isDev() ? 10 : 300;

    this.mainClient = {
      name: schema,
      client: new PrismaClient({
        ...(this.isDev() && { log: ['query'] }),
        datasources: {
          db: {
            url: `${process.env.DATABASE_URL}?schema=${schema}&connection_limit=${limitConnections}&pool_timeout=${timeOut}`,
          },
        },
      }),
    };
    this.logger.debug(
      `Prisma: set main client for schema: ${this.mainClient.name}`,
    );
    return this.mainClient.client;
  }

  private createClient(schema: string): PrismaClient {
    const limitConnections = this.isDev() ? 2 : 5;
    const timeOut = this.isDev() ? 5 : 60;

    return new PrismaClient({
      ...(this.isDev() && { log: ['query'] }),
      datasources: {
        db: {
          url: `${process.env.DATABASE_URL}?schema=${schema}&connection_limit=${limitConnections}&pool_timeout=${timeOut}`,
        },
      },
    });
  }

  async onModuleDestroy() {
    this.logger.log('PrismaClientFactory: cleaning up resources...');

    if (this.mainClient?.client) {
      await this.mainClient.client.$disconnect();
      this.logger.debug(
        `Prisma: disconnected main schema: ${this.mainClient.name}`,
      );
    }

    for (const [schema, client] of this.clients.entries()) {
      await client.$disconnect();
      this.logger.debug(`Prisma: disconnected cached schema: ${schema}`);
    }

    this.clients.clear();
    this.logger.log('Prisma: all Prisma clients disconnected');
  }

  private isDev(): boolean {
    return process.env.NODE_ENV === 'development';
  }
}
