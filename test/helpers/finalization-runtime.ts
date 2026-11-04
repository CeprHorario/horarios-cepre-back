import { ConflictException, NotFoundException } from '@nestjs/common';
import type { RuntimeConfig } from '../../src/modules/runtime-config/interfaces/runtime-config.interface';

/** Sustituto explícito de Firestore para caracterizar UI; no prueba Firestore/IAM. */
export function finalizationRuntime(runtime: RuntimeConfig) {
  const history: RuntimeConfig[] = [];
  const update = (input: Pick<RuntimeConfig, 'maintenance' | 'schemaRouting' | 'changeReason'> & { expectedVersion: number }, actor: RuntimeConfig['updatedBy']) => {
    if (runtime.version !== input.expectedVersion) throw new ConflictException('La configuración cambió');
    history.unshift(structuredClone(runtime));
    Object.assign(runtime, structuredClone(input), { version: runtime.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor });
    delete (runtime as RuntimeConfig & { expectedVersion?: number }).expectedVersion;
    return Promise.resolve(structuredClone(runtime));
  };
  return {
    getCurrent: () => Promise.resolve(structuredClone(runtime)),
    getHistory: () => Promise.resolve(structuredClone(history)),
    update,
    rollback: (version: number, actor: RuntimeConfig['updatedBy']) => {
      const previous = history.find(item => item.version === version);
      if (!previous) throw new NotFoundException('Versión sintética no encontrada');
      return update({ maintenance: previous.maintenance, schemaRouting: previous.schemaRouting, changeReason: `Restaurar versión ${version}`, expectedVersion: runtime.version }, actor);
    },
  };
}
