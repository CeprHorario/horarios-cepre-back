import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { assertSchemaName } from '../schema-manager/schema-name';

// Only inside a transaction on its pinned connection, never on a pool.
export async function applyStructure(
  db: PoolClient,
  schema: string,
  create = false,
): Promise<string> {
  assertSchemaName(schema);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `structure:${schema}`,
  ]);
  if (create) await db.query(`CREATE SCHEMA "${schema}"`);
  const exists = await db.query(
    'SELECT 1 FROM pg_namespace WHERE nspname = $1',
    [schema],
  );
  if (!exists.rowCount) throw new Error(`Missing schema ${schema}`);
  await db.query(`SET LOCAL search_path TO "${schema}"`);
  await db.query(`CREATE TABLE IF NOT EXISTS "${schema}"._structure_migrations (
    version varchar(64) PRIMARY KEY, checksum varchar(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const directory = join(__dirname, 'migrations');
  const versions = (await readdir(directory, { withFileTypes: true }))
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort();
  const applied = await db.query<{ version: string; checksum: string }>(
    `SELECT version, checksum FROM "${schema}"._structure_migrations ORDER BY version`,
  );
  if (applied.rows.some((row, index) => row.version !== versions[index]))
    throw new Error(`Unknown migration history in ${schema}`);
  for (const version of versions) {
    const sql = await readFile(
      join(directory, version, 'migration.sql'),
      'utf8',
    );
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = applied.rows.find((row) => row.version === version);
    if (previous) {
      if (previous.checksum !== checksum)
        throw new Error(`Modified migration ${version}`);
      continue;
    }
    await db.query(sql);
    await db.query(
      `INSERT INTO "${schema}"._structure_migrations (version, checksum) VALUES ($1, $2)`,
      [version, checksum],
    );
  }
  return versions.at(-1)!;
}
