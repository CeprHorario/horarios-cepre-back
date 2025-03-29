import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { admissionProcesses } from '@database/drizzle/schema';
import { AdmissionBaseDto, AdmissionDto, CreateAdmissionDto } from './dto';

// Add database imports:
//import { PrismaService } from '@database/prisma/prisma.service';
import { DrizzleService } from '@database/drizzle/drizzle.service';
import { eq } from 'drizzle-orm';
import { SchemaManagerService } from 'schema-manager/schema-manger.service';
import { PrismaService } from 'prisma/prisma.service';
//import { PrismaClientFactory } from 'prisma/prisma-client.factory';

@Injectable()
export class AdmissionsService {
  constructor(
    //private readonly prisma: PrismaService,
    //private readonly factory: PrismaClientFactory,
    private readonly schemaManager: SchemaManagerService,
    private readonly drizzle: DrizzleService,
    private readonly prisma: PrismaService,
  ) {}

  // Metodo para crear un nuevo proceso de admisión
  async create(dataCreate: CreateAdmissionDto) {
    dataCreate.name = dataCreate.name.replace(/\s/g, '_').toLowerCase();
    const obj = await this.drizzle.db
      .insert(admissionProcesses)
      .values(dataCreate)
      .returning();
    const admission: AdmissionDto[] = plainToInstance(AdmissionDto, obj);

    // Establecer el nuevo proceso en mi prisma factory y la migracion de data inicial
    await this.schemaManager.setCurrentSchema(
      admission[0].name,
      admission[0].year,
    );
    await this.prisma.migrationInitialSchema(admission[0].name);
    return admission;
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
        excludePrefixes: ['id', 'description', 'isCurrent', 'createdAt'],
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

  async getAllWithCache() {
    return await this.schemaManager.getAllWithCache();
  }

  async getCurrent() {
    return await this.schemaManager.getCurrent();
  }
}
