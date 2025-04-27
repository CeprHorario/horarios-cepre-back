import { Injectable } from '@nestjs/common';
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
    const nameParsed = `${body.name.replace(/\s/g, '_').toLowerCase()}_${body.year}`;
    // const admission = await this.drizzle.db
    //   .insert(admissionProcesses)
    //   .values({
    //     name: nameParsed,
    //     year: body.year,
    //     started: body.started,
    //     finished: body.finished,
    //   })
    //   .returning();

    // // Establecer el nuevo proceso en mi prisma factory y la migracion de data inicial
    // await this.schemaManager.setCurrentSchema(nameParsed, admission[0].year);

    // Establecer el nuevo proceso en mi prisma factory y la migracion de data inicial
    await this.prisma.migrationInitialSchema(nameParsed /* admission[0].name */, body.configuration);
    return body;
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
