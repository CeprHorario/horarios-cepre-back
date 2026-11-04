import { Prisma } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/database/prisma/prisma.service';

/** Mapear SQL core fijo a core sintético del harness, sin crear/tocar core_schema. */
export function finalizationPrisma(prisma: PrismaService, coreSchema: string) {
  if (!/^sr_[a-f0-9]{32}_core$/.test(coreSchema))
    throw new Error('Core no pertenece al fixture aleatorio');
  const clients = new Map<string, ReturnType<typeof extend>>();
  const remap = (value: Prisma.Sql) => Prisma.sql(
    value.strings.map(text => text.replaceAll('core_schema.', `"${coreSchema}".`)),
    ...value.values,
  );
  function extend(schema: string) {
    return prisma.getClientForSchema(schema).$extends({ query: {
      $queryRaw: ({ args, query }) => query(remap(args)),
      $executeRaw: ({ args, query }) => query(remap(args)),
    } });
  }
  const get = (schema: string) => {
    const actual = schema === 'core_schema' ? coreSchema : schema;
    let client = clients.get(actual);
    if (!client) { client = extend(actual); clients.set(actual, client); }
    return client;
  };
  return {
    getClient: () => get(prisma.getSchemaName()),
    getClientForSchema: get,
    getSchemaName: () => prisma.getSchemaName(),
  };
}
