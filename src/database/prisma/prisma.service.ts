import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { Pool } from 'pg';
import { RequestContext } from '../schema-manager/request-context';
import { assertSchemaName } from '../schema-manager/schema-name';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly clients = new Map<string, PrismaClient>();
  private readonly pool: Pool;

  constructor(
    config: ConfigService,
    private readonly context: RequestContext,
  ) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: config.getOrThrow<number>('DB_POOL_MAX'),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      application_name: 'cepr-prisma',
    });
    this.pool.on('error', (error: Error) =>
      new Logger(PrismaService.name).error(error.message),
    );
  }

  getClient(): PrismaClient {
    return this.getClientForSchema(this.getSchemaName());
  }

  getSchemaName(): string {
    const schema = this.context.require().schema;
    if (!schema) throw new Error('No authorized request schema');
    assertSchemaName(schema);
    return schema;
  }

  getClientForSchema(schema: string): PrismaClient {
    assertSchemaName(schema);
    let client = this.clients.get(schema);
    if (!client) {
      client = new PrismaClient({
        adapter: new PrismaPg(this.pool, {
          schema,
          disposeExternalPool: false,
        }),
      });
      this.clients.set(schema, client);
    }
    return client;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map((client) => client.$disconnect()),
    );
    await this.pool.end();
  }
}
