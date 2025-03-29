import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { DrizzleService } from '@database/drizzle/drizzle.service';
import { eq } from 'drizzle-orm';
import { admissionProcesses } from '@database/drizzle/schema';
import { AdmissionCurrentDto } from '@modules/admissions/dto';

@Injectable()
export class SchemaManagerService {
  constructor(
    private readonly drizzle: DrizzleService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private config: ConfigService,
  ) {}

  // Obtener el esquema actual
  async getCurrent(): Promise<AdmissionCurrentDto> {
    const currentKey = this.config.get<string>(
      'CACHE_KEYS.CURRENT_ADMISSION',
    ) as string;
    const current = await this.cacheManager.get(currentKey);
    if (current) return current as AdmissionCurrentDto;

    // Obtener el proceso de admisión actual desde la base de datos
    const obj = await this.drizzle.db.query.admissionProcesses.findFirst({
      columns: {
        name: true,
        year: true,
      },
      where: eq(admissionProcesses.isCurrent, true),
    });

    // Si no hay proceso de admisión actual, retornar el core schema
    if (!obj) {
      const coreSchema = this.config.get<string>('CORE_SCHEMA') as string;
      return { name: coreSchema, year: 0 };
    }

    // Guardar el proceso de admisión actual en cache
    await this.cacheManager.set(currentKey, obj);
    return obj;
  }

  // Obtener todos los esquemas disponibles sin current
  async getAllWithCache(): Promise<AdmissionCurrentDto[]> {
    const cacheKey = this.config.get<string>(
      'CACHE_KEYS.ALL_ADMISSION',
    ) as string;

    // Obtener la clave de cache
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) return cachedData as AdmissionCurrentDto[];

    // Obtener los datos de la base de datos en caso de no estar en cache
    const data = await this.drizzle.db.query.admissionProcesses.findMany({
      columns: {
        name: true,
        year: true,
      },
      where: eq(admissionProcesses.isCurrent, false),
    });

    // Guardar los datos en cache
    await this.cacheManager.set(cacheKey, data);
    return data;
  }

  // Actualizar el esquema actual
  async setCurrentSchema(schemaName: string, year: number) {
    // 1. Eliminar de cache los procesos de admision
    const cacheKey = this.config.get<string>(
      'CACHE_KEYS.ALL_ADMISSION',
    ) as string;
    await this.cacheManager.del(cacheKey);

    // 2. Eliminar de cache proceso current
    const currentKey = this.config.get<string>(
      'CACHE_KEYS.CURRENT_ADMISSION',
    ) as string;

    // Actualizar en cache y establecemos en el main
    await this.cacheManager.set(currentKey, { name: schemaName, year: year });

    //return this.prisma.setMainClient(schemaName);
  }

  // Verificar si un esquema existe
  async schemaExists(schemaName: string): Promise<boolean> {
    const schemas = await this.getAllWithCache();
    return schemas.some((s) => s.name === schemaName);
  }
}
