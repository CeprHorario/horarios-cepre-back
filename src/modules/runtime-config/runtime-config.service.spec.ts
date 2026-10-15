import { RuntimeConfigService } from './runtime-config.service';

class SchemaRoutingDtoLike {
  adminSchema = 'core_schema';
  userSchema = 'users_2026';
}

class MaintenanceDtoLike {
  enabled = true;
  message = 'Mantenimiento de prueba';
  endsAt: string | null = null;
}

describe('RuntimeConfigService Firestore serialization', () => {
  it('converts DTO class instances to plain Firestore maps', async () => {
    const currentData = {
      version: 1,
      maintenance: { enabled: false, message: 'Disponible', endsAt: null },
      schemaRouting: {
        adminSchema: 'core_schema',
        userSchema: 'users_2025',
      },
      updatedAt: null,
      updatedBy: { id: 'old', email: 'old@unsa.edu.pe' },
      changeReason: 'Inicial',
    };
    const updatedData = {
      ...currentData,
      version: 2,
      maintenance: {
        enabled: true,
        message: 'Mantenimiento de prueba',
        endsAt: null,
      },
      schemaRouting: {
        adminSchema: 'core_schema',
        userSchema: 'users_2026',
      },
    };
    const historyDocument = {};
    const runtimeDocument = {
      collection: jest.fn(() => ({ doc: jest.fn(() => historyDocument) })),
      get: jest
        .fn()
        .mockResolvedValue({ exists: true, data: () => updatedData }),
    };
    const transaction = {
      get: jest
        .fn()
        .mockResolvedValue({ exists: true, data: () => currentData }),
      set: jest.fn<void, [unknown, Record<string, unknown>]>(),
    };
    const firestore = {
      collection: jest.fn(() => ({ doc: jest.fn(() => runtimeDocument) })),
      runTransaction: jest.fn(
        (callback: (value: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const config = { get: jest.fn(() => 15000) };
    const service = new RuntimeConfigService(
      firestore as never,
      config as never,
    );

    await service.update(
      {
        expectedVersion: 1,
        maintenance: new MaintenanceDtoLike(),
        schemaRouting: new SchemaRoutingDtoLike(),
        changeReason: 'Prueba de serialización',
      },
      { id: 'admin-id', email: 'admin@unsa.edu.pe' },
    );

    const writtenConfig = transaction.set.mock.calls[1][1] as {
      schemaRouting: Record<string, unknown>;
      maintenance: Record<string, unknown>;
    };
    expect(Object.getPrototypeOf(writtenConfig.schemaRouting)).toBe(
      Object.prototype,
    );
    expect(Object.getPrototypeOf(writtenConfig.maintenance)).toBe(
      Object.prototype,
    );
    expect(writtenConfig.schemaRouting).toEqual({
      adminSchema: 'core_schema',
      userSchema: 'users_2026',
    });
  });
});
