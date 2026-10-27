import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRuntimeConfigDto } from './update-runtime-config.dto';

describe('Runtime config maintenance validation', () => {
  const payload = (enabled: boolean, message: unknown) =>
    plainToInstance(UpdateRuntimeConfigDto, {
      expectedVersion: 1,
      maintenance: { enabled, message, endsAt: null },
      schemaRouting: { adminSchema: 'new_process', userSchema: 'old_process' },
      changeReason: 'Cambiar proceso del administrador',
    });

  it('permite cambiar de proceso con mantenimiento desactivado y mensaje vacío', async () => {
    expect(await validate(payload(false, ''))).toHaveLength(0);
  });

  it('exige mensaje al activar mantenimiento, incluyendo espacios', async () => {
    for (const message of ['', '   '])
      expect(await validate(payload(true, message))).not.toHaveLength(0);
    expect(await validate(payload(true, 'Mantenimiento programado'))).toHaveLength(0);
  });

  it('mantiene los límites y tipos aun con mantenimiento desactivado', async () => {
    for (const message of [null, 42, 'x'.repeat(256)])
      expect(await validate(payload(false, message))).not.toHaveLength(0);
  });
});
