import { ConfigService } from '@nestjs/config';
import { Firestore } from '@google-cloud/firestore';
import { RuntimeConfigService } from './runtime-config.service';
import { RuntimeConfig } from './interfaces/runtime-config.interface';

describe('Firestore runtime contract', () => {
  const actor = { id: 'admin', email: 'admin@example.com' };
  let documents: Map<string, Record<string, unknown>>;
  let first: RuntimeConfigService;
  let second: RuntimeConfigService;

  beforeEach(() => {
    jest.useFakeTimers();
    const initial: RuntimeConfig = {
      version: 1,
      maintenance: { enabled: false, message: 'Ready', endsAt: null },
      schemaRouting: { adminSchema: 'alpha', userSchema: 'beta' },
      updatedAt: null,
      updatedBy: actor,
      changeReason: 'Initial',
    };
    documents = new Map([['system_config/runtime', { ...initial }]]);
    const snapshot = (path: string) => ({
      exists: documents.has(path),
      data: () => documents.get(path),
    });
    const reference = (path: string) => ({
      path,
      get: () => Promise.resolve(snapshot(path)),
      collection: (name: string) => collection(`${path}/${name}`),
    });
    const collection = (path: string) => ({
      doc: (name: string) => reference(`${path}/${name}`),
      orderBy: () => ({
        limit: (limit: number) => ({
          get: () =>
            Promise.resolve({
              docs: [...documents.entries()]
                .filter(([key]) => key.startsWith(`${path}/`))
                .sort((a, b) => Number(b[1].version) - Number(a[1].version))
                .slice(0, limit)
                .map(([key]) => snapshot(key)),
            }),
        }),
      }),
    });
    let lock = Promise.resolve();
    const firestore = {
      collection,
      runTransaction: (
        callback: (tx: {
          get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
          set: (ref: { path: string }, data: Record<string, unknown>) => void;
        }) => Promise<void>,
      ) => {
        const result = lock.then(async () => {
          const writes = new Map<string, Record<string, unknown>>();
          await callback({
            get: (ref) => Promise.resolve(snapshot(ref.path)),
            set: (ref, data) => {
              writes.set(ref.path, data);
            },
          });
          writes.forEach((data, path) => documents.set(path, data));
        });
        lock = result.catch(() => undefined);
        return result;
      },
    } as unknown as Firestore;
    const config = new ConfigService({ RUNTIME_CONFIG_CACHE_TTL_MS: 1000 });
    first = new RuntimeConfigService(firestore, config);
    second = new RuntimeConfigService(firestore, config);
  });

  afterEach(() => jest.useRealTimers());

  it('invalidates locally after commit and converges on another replica at TTL', async () => {
    const old = (await second.getCurrent())!;
    const changed = await first.update(
      {
        ...old,
        expectedVersion: old.version,
        schemaRouting: { adminSchema: 'new_admin', userSchema: 'new_user' },
      },
      actor,
    );
    expect(changed.version).toBe(2);
    expect((await second.getCurrent())?.version).toBe(1);
    jest.advanceTimersByTime(1001);
    expect((await second.getCurrent())?.schemaRouting).toEqual({
      adminSchema: 'new_admin',
      userSchema: 'new_user',
    });
    expect((await first.getHistory(10)).map((item) => item.version)).toEqual([
      1,
    ]);
    expect((await first.rollback(1, actor)).version).toBe(3);
    expect((await first.getCurrent())?.schemaRouting).toEqual(
      old.schemaRouting,
    );
    expect((await first.getHistory(10)).map((item) => item.version)).toEqual([
      2, 1,
    ]);
  });

  it('accepts one concurrent expectedVersion writer without losing history', async () => {
    const current = (await first.getCurrent())!;
    const input = {
      ...current,
      expectedVersion: 1,
      changeReason: 'Concurrent write',
    };
    const results = await Promise.allSettled([
      first.update(input, actor),
      second.update(input, actor),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(
      1,
    );
    expect(documents.get('system_config/runtime')?.version).toBe(2);
    expect(
      documents.get('system_config/runtime/history/000000000001')?.version,
    ).toBe(1);
  });
});
