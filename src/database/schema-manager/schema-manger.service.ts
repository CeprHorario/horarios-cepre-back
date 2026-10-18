import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DrizzleService } from '../drizzle/drizzle.service';
import { admissionProcesses } from '../drizzle/schema';
import { assertSchemaName } from './schema-name';

@Injectable()
export class SchemaManagerService {
  constructor(private readonly drizzle: DrizzleService) {}

  async getCurrent() {
    return (
      (await this.drizzle.db.query.admissionProcesses.findFirst({
        columns: { name: true, year: true },
        where: eq(admissionProcesses.isCurrent, true),
      })) ?? { name: 'core_schema', year: 0 }
    );
  }

  async getAllWithCache() {
    const processes = await this.drizzle.db.query.admissionProcesses.findMany({
      columns: { name: true, year: true },
    });
    return [{ name: 'core_schema', year: 0 }, ...processes];
  }

  async schemaExists(name: string): Promise<boolean> {
    try {
      assertSchemaName(name);
    } catch {
      return false;
    }
    const result = await this.drizzle.db.execute(sql`
      SELECT 1 FROM pg_namespace n WHERE n.nspname = ${name}
      AND (${name} = 'core_schema' OR EXISTS (
        SELECT 1 FROM public.admission_processes p WHERE p.name = ${name}
      ))`);
    return result.rows.length > 0;
  }

  async assertAvailable(name: string): Promise<void> {
    if (!(await this.schemaExists(name))) {
      throw new ServiceUnavailableException({
        code: 'INVALID_SCHEMA_ROUTING',
        message: `El schema configurado "${name}" no está disponible`,
      });
    }
  }
}
