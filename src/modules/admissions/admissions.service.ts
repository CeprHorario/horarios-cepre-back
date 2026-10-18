import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DrizzleService } from '@database/drizzle/drizzle.service';
import { admissionProcesses } from '@database/drizzle/schema';
import { SchemaManagerService } from '@database/schema-manager/schema-manger.service';
import { assertSchemaName } from '@database/schema-manager/schema-name';
import { applyStructure } from '@database/prisma/structure';
import { initialDataSchema } from '@database/prisma/data/seed';
import { AdmissionBaseDto } from './dto';
import { ProcessAdmissionDto } from './dto/create-admission.dto';

@Injectable()
export class AdmissionsService {
  constructor(
    private readonly schemaManager: SchemaManagerService,
    private readonly drizzle: DrizzleService,
  ) {}

  async create(body: ProcessAdmissionDto) {
    if (body.started >= body.finished)
      throw new BadRequestException(
        'The start date must be less than the end date',
      );
    const name = `${body.name
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()}_${body.year}`;
    assertSchemaName(name);
    if (name === 'core_schema')
      throw new BadRequestException('Reserved schema');
    let result: typeof admissionProcesses.$inferSelect;
    try {
      result = await this.drizzle.transaction(async (connection) => {
        await connection.query(
          "SELECT pg_advisory_xact_lock(hashtext('admissions'))",
        );
        const version = await applyStructure(connection, name, true);
        if (body.configuration)
          await initialDataSchema(connection, body.configuration);
        await connection.query('SET LOCAL search_path TO public');
        const tx = drizzle(connection);
        await tx.update(admissionProcesses).set({ isCurrent: false });
        const [admission] = await tx
          .insert(admissionProcesses)
          .values({
            name,
            year: body.year,
            description: `${body.name} ${body.year}`,
            started: body.started,
            finished: body.finished,
            structureVersion: version,
          })
          .returning();
        return admission;
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42P06' || code === '23505')
        throw new ConflictException(
          `Admission process already exists with name: ${name}`,
        );
      throw new BadRequestException('Error while creating admission process', {
        cause: error,
      });
    }
    return {
      success: true,
      message: `Schema created and data migrated successfully in ${body.name} ${body.year}`,
      data: plainToInstance(AdmissionBaseDto, result, {
        excludePrefixes: ['id', 'isCurrent', 'createdAt', 'structureVersion'],
      }),
    };
  }

  async getAllRelations() {
    const rows = await this.drizzle.db.query.admissionProcesses.findMany({
      with: { observations: { columns: { description: true } } },
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });
    return rows.map((row) =>
      plainToInstance(AdmissionBaseDto, row, {
        excludePrefixes: ['id', 'createdAt', 'structureVersion'],
      }),
    );
  }

  async getOneWithObservations(name: string) {
    return plainToInstance(
      AdmissionBaseDto,
      await this.drizzle.db.query.admissionProcesses.findFirst({
        where: eq(admissionProcesses.name, name),
        with: {
          observations: { columns: { description: true, createdAt: true } },
        },
      }),
      { excludePrefixes: ['structureVersion'] },
    );
  }

  async setCurrent(name: string) {
    assertSchemaName(name);
    const admission = await this.drizzle.transaction(async (connection) => {
      await connection.query(
        "SELECT pg_advisory_xact_lock(hashtext('admissions'))",
      );
      const valid = await connection.query(
        'SELECT 1 FROM public.admission_processes p JOIN pg_namespace n ON n.nspname = p.name WHERE p.name = $1',
        [name],
      );
      if (!valid.rowCount)
        throw new ConflictException(
          `Admission process not found with name: ${name}`,
        );
      const tx = drizzle(connection);
      await tx.update(admissionProcesses).set({ isCurrent: false });
      return (
        await tx
          .update(admissionProcesses)
          .set({ isCurrent: true })
          .where(eq(admissionProcesses.name, name))
          .returning()
      )[0];
    });
    return {
      success: true,
      message: `Process admissions set as current successfully in ${admission.description}`,
      data: plainToInstance(AdmissionBaseDto, admission, {
        excludePrefixes: ['id', 'isCurrent', 'createdAt', 'structureVersion'],
      }),
    };
  }

  getAllWithCache() {
    return this.schemaManager.getAllWithCache();
  }
  getCurrent() {
    return this.schemaManager.getCurrent();
  }
  async getCurrentWithObservations() {
    return plainToInstance(
      AdmissionBaseDto,
      await this.drizzle.db.query.admissionProcesses.findFirst({
        where: eq(admissionProcesses.isCurrent, true),
        with: {
          observations: { columns: { description: true, createdAt: true } },
        },
      }),
      { excludePrefixes: ['id', 'isCurrent', 'createdAt', 'structureVersion'] },
    );
  }
}
