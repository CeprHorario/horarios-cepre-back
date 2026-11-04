import type { PrismaClient } from '../../src/generated/prisma/client';

/** Only random integration-fixture schemas. Never imported by src/ or installed by applyStructure. */
export async function installPartTestClock(
  client: PrismaClient,
  schema: string,
) {
  if (process.env.NODE_ENV !== 'test' || !/^sr_[a-f0-9]{32}_[ab]$/.test(schema))
    throw new Error('Reloj de pruebas fuera del fixture aislado');
  await client.$executeRawUnsafe(`CREATE TABLE "${schema}".__test_part_clock (
    id int PRIMARY KEY CHECK(id=1), base_time timestamptz NOT NULL, real_anchor timestamptz NOT NULL,
    speed double precision NOT NULL CHECK(speed BETWEEN 0 AND 60))`);
  await client.$executeRawUnsafe(
    `INSERT INTO "${schema}".__test_part_clock VALUES(1,clock_timestamp(),clock_timestamp(),1)`,
  );
  await client.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "${schema}".session_clock_now() RETURNS timestamptz
    LANGUAGE sql VOLATILE AS $$ SELECT base_time+(clock_timestamp()-real_anchor)*speed FROM "${schema}".__test_part_clock WHERE id=1 $$`);
  return {
    set: async (base: Date, speed = 1) => {
      if (
        !Number.isFinite(+base) ||
        !Number.isFinite(speed) ||
        speed < 0 ||
        speed > 60
      )
        throw new Error('Instante/velocidad de prueba inválidos');
      await client.$executeRawUnsafe(
        `UPDATE "${schema}".__test_part_clock SET base_time=$1,real_anchor=clock_timestamp(),speed=$2 WHERE id=1`,
        base,
        speed,
      );
    },
    close: async () => {
      await client.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION "${schema}".session_clock_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT clock_timestamp() $$`,
      );
      await client.$executeRawUnsafe(
        `DROP TABLE "${schema}".__test_part_clock`,
      );
    },
  };
}
