import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { admissionProcesses } from '@database/drizzle/schema';
import { AdmissionBaseDto } from './dto';

import { DrizzleService } from '@database/drizzle/drizzle.service';
import { eq } from 'drizzle-orm';
import { SchemaManagerService } from '@database/schema-manager/schema-manger.service';
import { PrismaService } from '@database/prisma/prisma.service';
import { ProcessAdmissionDto } from './dto/create-admission.dto';

@Injectable()
export class AdmissionsService {
  constructor(
    private readonly schemaManager: SchemaManagerService,
    private readonly drizzle: DrizzleService,
    private readonly prisma: PrismaService,
  ) {}

  // Metodo para crear un nuevo proceso de admisión
  async create(body: ProcessAdmissionDto) {
    if (body.started < body.finished) {
      throw new BadRequestException(
        'The start date must be less than the end date',
      );
    }

    const result = await this.drizzle.db
      .transaction(async (tx) => {
        // 0: Marcar los procesos de admisión anteriores como no actuales
        await tx.update(admissionProcesses).set({
          isCurrent: false,
        });

        // 1: Insertar el nuevo proceso de admisión
        const result = await tx
          .insert(admissionProcesses)
          .values({
            name: this.parseSchemaName(body.name, body.year),
            year: body.year,
            description: body.name + ' ' + body.year,
            started: body.started,
            finished: body.finished,
          })
          .returning()
          .catch(() => {
            throw new ConflictException(
              `Admission process already exists with name: ${body.name}`,
            );
          });
        const admission = result[0];

        // 2: Establecer el nuevo proceso en mi prisma factory y la migracion de data inicial
        await this.prisma.migrationInitialSchema(
          admission.name,
          body.configuration,
        );

        // 3: Establecer el nuevo proceso en mi schema manager y en cache
        await this.schemaManager.setCurrentSchema(
          admission.name,
          admission.year,
        );

        return admission;
      })
      .catch((error) => {
        // Manejo específico de errores
        if (error instanceof Error && error.message.includes('unique')) {
          throw new ConflictException(
            `Admission process already exists with name: ${body.name} ${body.year}`,
          );
        }

        // Otros errores
        console.error('***Error*** ', error);
        throw new BadRequestException('Error while creating admission process');
      });

    return {
      success: true,
      message: `Schema created and data migrated successfully in ${body.name} ${body.year}`,
      data: plainToInstance(AdmissionBaseDto, result, {
        excludePrefixes: ['id', 'isCurrent', 'createdAt'],
      }),
    };
  }

  // Metodo para obtener todos los procesos de admisión con sus observaciones
  async getAllRelations() {
    const obj = await this.drizzle.db.query.admissionProcesses.findMany({
      with: {
        observations: {
          columns: {
            description: true,
          },
        },
      },
    });
    return obj.map((item) =>
      plainToInstance(AdmissionBaseDto, item, {
        excludePrefixes: ['id', 'isCurrent', 'createdAt'],
      }),
    );
  }

  // Metodo para obtener un proceso de admisión por nombre con sus observaciones
  async getOneWithObservations(name: string) {
    const obj = await this.drizzle.db.query.admissionProcesses.findFirst({
      where: eq(admissionProcesses.name, name),
      with: {
        observations: {
          columns: {
            description: true,
            createdAt: true,
          },
        },
      },
    });
    return plainToInstance(AdmissionBaseDto, obj);
  }

  async setCurrent(nameSchema: string) {
    const result = await this.drizzle.db.transaction(async (tx) => {
      await tx.update(admissionProcesses).set({
        isCurrent: false,
      });
      return await tx
        .update(admissionProcesses)
        .set({
          isCurrent: true,
        })
        .where(eq(admissionProcesses.name, nameSchema))
        .returning();
    });

    if (!result.length) {
      throw new ConflictException(
        `Admission process not found with name: ${nameSchema}`,
      );
    }

    const admission = result[0];
    // Establecer el nuevo proceso en mi prisma factory y en cache
    await this.prisma.setMainClient(nameSchema);
    await this.schemaManager.setCurrentSchema(nameSchema, admission.year);
  }

  async getAllWithCache() {
    return await this.schemaManager.getAllWithCache();
  }

  async getCurrent() {
    return await this.schemaManager.getCurrent();
  }

  async getCurrentWithObservations() {
    const obj = await this.drizzle.db.query.admissionProcesses.findFirst({
      where: eq(admissionProcesses.isCurrent, true),
      with: {
        observations: {
          columns: {
            description: true,
            createdAt: true,
          },
        },
      },
    });
    return plainToInstance(AdmissionBaseDto, obj, {
      excludePrefixes: ['id', 'isCurrent', 'createdAt'],
    });
  }

  private parseSchemaName(name: string, year: number | string): string {
    const sanitized = name
      .trim()
      .normalize('NFD') // elimina acentos
      .replace(/[\u0300-\u036f]/g, '') // elimina diacríticos residuales
      .replace(/[^a-zA-Z0-9]+/g, '_') // reemplaza cualquier cosa no alfanumérica por guión bajo
      .replace(/^_+|_+$/g, '') // elimina guiones bajos al inicio o final
      .toLowerCase();

    return `${sanitized}_${year}`;
  }
}
