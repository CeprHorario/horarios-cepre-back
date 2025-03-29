import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';

import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@database/drizzle/schema';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DrizzleService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  public db: NodePgDatabase<typeof schema>;
  private readonly logger = new Logger(DrizzleService.name);

  constructor(private configService: ConfigService) {
    const connectionString = this.configService.get<string>('DATABASE_URL');

    this.pool = new Pool({
      connectionString,
      //ssl: {
      //  rejectUnauthorized: false, // Ignora verificación de certificado (opcional según el proveedor)
      //},
      max: 20,
      idleTimeoutMillis: 2000000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      this.logger.error(`
        \nDrizzle: Failed to connect to the database: : \n${err.message}`);
    });

    // Inicializar Drizzle
    this.db = drizzle(this.pool, { schema }) as NodePgDatabase<typeof schema>;
  }

  async onModuleInit() {
    // Verificar conexión a la Base de Datos
    try {
      await this.pool.query('SELECT 1');
      this.logger.debug('Drizzle: connected successfully');
    } catch (error) {
      this.logger.error(`
        \nDrizzle: Failed to connect to the database: ${error}`);
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
    this.logger.debug('Drizzle: disconnected successfully');
  }
}
