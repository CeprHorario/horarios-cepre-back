import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldValue, Firestore, Timestamp } from '@google-cloud/firestore';
import {
  RuntimeActor,
  RuntimeConfig,
  UpdateRuntimeConfigInput,
} from './interfaces/runtime-config.interface';

export const FIRESTORE_CLIENT = 'FIRESTORE_CLIENT';

@Injectable()
export class RuntimeConfigService {
  private readonly logger = new Logger(RuntimeConfigService.name);
  private readonly runtimeDocument = this.firestore
    .collection('system_config')
    .doc('runtime');
  private readonly cacheTtlMs: number;
  private cachedConfig: RuntimeConfig | null = null;
  private cacheExpiresAt = 0;
  private refreshPromise: Promise<RuntimeConfig | null> | null = null;

  constructor(
    @Inject(FIRESTORE_CLIENT) private readonly firestore: Firestore,
    configService: ConfigService,
  ) {
    this.cacheTtlMs = Math.max(
      Number(configService.get('RUNTIME_CONFIG_CACHE_TTL_MS', 15000)),
      1000,
    );
  }

  async getCurrent(forceRefresh = false): Promise<RuntimeConfig | null> {
    if (
      !forceRefresh &&
      this.cachedConfig &&
      Date.now() < this.cacheExpiresAt
    ) {
      return this.cachedConfig;
    }

    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.loadCurrent();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async getHistory(limit: number): Promise<RuntimeConfig[]> {
    const snapshot = await this.runtimeDocument
      .collection('history')
      .orderBy('version', 'desc')
      .limit(Math.min(Math.max(limit, 1), 100))
      .get();

    return snapshot.docs.map((document) => this.decode(document.data()));
  }

  async update(
    input: UpdateRuntimeConfigInput,
    actor: RuntimeActor,
  ): Promise<RuntimeConfig> {
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(this.runtimeDocument);
      if (!snapshot.exists) {
        throw new NotFoundException(
          'No existe la configuración system_config/runtime en Firestore',
        );
      }

      const current = this.decode(snapshot.data());
      if (current.version !== input.expectedVersion) {
        throw new ConflictException({
          code: 'RUNTIME_CONFIG_VERSION_CONFLICT',
          message:
            'La configuración fue modificada por otro administrador. Actualice la página e intente nuevamente.',
          currentVersion: current.version,
        });
      }

      const historyReference = this.runtimeDocument
        .collection('history')
        .doc(this.versionId(current.version));

      transaction.set(historyReference, {
        ...snapshot.data(),
        archivedAt: FieldValue.serverTimestamp(),
        archivedBy: {
          id: actor.id,
          email: actor.email,
        },
      });

      transaction.set(this.runtimeDocument, {
        version: current.version + 1,
        maintenance: {
          enabled: input.maintenance.enabled,
          message: input.maintenance.message,
          endsAt: input.maintenance.endsAt
            ? Timestamp.fromDate(new Date(input.maintenance.endsAt))
            : null,
        },
        schemaRouting: {
          adminSchema: input.schemaRouting.adminSchema,
          userSchema: input.schemaRouting.userSchema,
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: {
          id: actor.id,
          email: actor.email,
        },
        changeReason: input.changeReason,
      });
    });

    return this.reloadAfterWrite('actualizada');
  }

  async rollback(version: number, actor: RuntimeActor): Promise<RuntimeConfig> {
    const historyReference = this.runtimeDocument
      .collection('history')
      .doc(this.versionId(version));

    await this.firestore.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(this.runtimeDocument);
      const historySnapshot = await transaction.get(historyReference);

      if (!currentSnapshot.exists) {
        throw new NotFoundException('No existe la configuración activa');
      }
      if (!historySnapshot.exists) {
        throw new NotFoundException(
          `No existe la versión histórica ${version}`,
        );
      }

      const current = this.decode(currentSnapshot.data());
      const historical = this.decode(historySnapshot.data());
      const currentHistoryReference = this.runtimeDocument
        .collection('history')
        .doc(this.versionId(current.version));

      transaction.set(currentHistoryReference, {
        ...currentSnapshot.data(),
        archivedAt: FieldValue.serverTimestamp(),
        archivedBy: {
          id: actor.id,
          email: actor.email,
        },
      });

      transaction.set(this.runtimeDocument, {
        version: current.version + 1,
        maintenance: {
          ...historical.maintenance,
          endsAt: historical.maintenance.endsAt
            ? Timestamp.fromDate(new Date(historical.maintenance.endsAt))
            : null,
        },
        schemaRouting: {
          adminSchema: historical.schemaRouting.adminSchema,
          userSchema: historical.schemaRouting.userSchema,
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: {
          id: actor.id,
          email: actor.email,
        },
        changeReason: `Restauración de la versión ${version}`,
        restoredFromVersion: version,
      });
    });

    return this.reloadAfterWrite('restaurada');
  }

  invalidateCache(): void {
    this.cacheExpiresAt = 0;
  }

  private async reloadAfterWrite(action: string): Promise<RuntimeConfig> {
    this.invalidateCache();
    const updated = await this.getCurrent(true);
    if (!updated) {
      throw new NotFoundException(
        `No fue posible leer la configuración ${action}`,
      );
    }
    return updated;
  }

  private async loadCurrent(): Promise<RuntimeConfig | null> {
    try {
      const snapshot = await this.runtimeDocument.get();
      if (!snapshot.exists) {
        this.logger.warn(
          'Firestore document system_config/runtime does not exist; using compatibility fallback',
        );
        return this.cachedConfig;
      }

      const config = this.decode(snapshot.data());
      this.cachedConfig = config;
      this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
      return config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Unable to load runtime configuration; using last valid value: ${message}`,
      );
      return this.cachedConfig;
    }
  }

  private decode(
    data: FirebaseFirestore.DocumentData | undefined,
  ): RuntimeConfig {
    if (!data) throw new NotFoundException('Configuración vacía');

    const maintenance = data.maintenance as Record<string, unknown> | undefined;
    const routing = data.schemaRouting as Record<string, unknown> | undefined;
    const updatedBy = data.updatedBy as Record<string, unknown> | undefined;

    if (
      !Number.isInteger(data.version) ||
      typeof maintenance?.enabled !== 'boolean' ||
      typeof maintenance.message !== 'string' ||
      typeof routing?.adminSchema !== 'string' ||
      typeof routing.userSchema !== 'string'
    ) {
      throw new Error('Invalid Firestore runtime configuration structure');
    }

    return {
      version: data.version as number,
      maintenance: {
        enabled: maintenance.enabled,
        message: maintenance.message,
        endsAt: this.toIsoString(maintenance.endsAt),
      },
      schemaRouting: {
        adminSchema: routing.adminSchema,
        userSchema: routing.userSchema,
      },
      updatedAt: this.toIsoString(data.updatedAt),
      updatedBy: {
        id: typeof updatedBy?.id === 'string' ? updatedBy.id : 'unknown',
        email:
          typeof updatedBy?.email === 'string' ? updatedBy.email : 'unknown',
      },
      changeReason:
        typeof data.changeReason === 'string' ? data.changeReason : '',
    };
  }

  private toIsoString(value: unknown): string | null {
    if (value instanceof Timestamp) return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    return null;
  }

  private versionId(version: number): string {
    return String(version).padStart(12, '0');
  }
}
