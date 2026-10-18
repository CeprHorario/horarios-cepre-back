import 'dotenv/config';
import { Pool } from 'pg';
import { applyStructure } from './structure';

async function deploy() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('admissions'))");
    const processes = await db.query<{ name: string }>(
      'SELECT name FROM public.admission_processes ORDER BY id',
    );
    await db.query('CREATE SCHEMA IF NOT EXISTS core_schema');
    for (const schema of [
      'core_schema',
      ...processes.rows.map((row) => row.name),
    ]) {
      const version = await applyStructure(db, schema);
      await db.query(
        'UPDATE public.admission_processes SET structure_version = $1 WHERE name = $2',
        [version, schema],
      );
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}

void deploy().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
