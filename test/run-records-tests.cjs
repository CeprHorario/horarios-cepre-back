const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdirSync, mkdtempSync } = require('node:fs');
const { Pool } = require('pg');

async function main() {
  const base = new URL(process.env.DATABASE_URL);
  if (
    process.env.NODE_ENV !== 'test' ||
    base.hostname !== 'db' ||
    base.pathname !== '/cepr_records_test'
  )
    throw new Error(
      'Use exclusivamente compose.records.yaml; no se prueba sobre bases existentes',
    );
  const name = `cepr_records_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: base.toString() });
  mkdirSync('/tmp/opencode', { recursive: true });
  const output = mkdtempSync('/tmp/opencode/cepr-records-security-');
  await pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(base);
  url.pathname = `/${name}`;
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    TEST_DATABASE_URL: url.toString(),
    AVAILABILITY_TEST_DATABASE_URL: url.toString(),
    SECURITY_AUDIT_DATABASE_URL: url.toString(),
    SECURITY_AUDIT_OUTPUT_DIR: output,
  };
  try {
    // Existing provisioning suite owns public/core setup. Run it first on the empty DB;
    // the remaining opt-in suites depend on that catalog and use isolated schemas.
    for (const args of [
      [
        'test',
        '--',
        '--runInBand',
        '--runTestsByPath',
        'test/database.e2e-spec.ts',
      ],
      [
        'test',
        '--',
        '--runInBand',
        '--testPathIgnorePatterns=test/database.e2e-spec.ts',
      ],
    ]) {
      const result = spawnSync('npm', args, { env, stdio: 'inherit' });
      if (result.status !== 0)
        throw new Error(`npm ${args.join(' ')} falló (${result.status})`);
    }
  } finally {
    // Only the database generated above is removed; never public/user databases.
    await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
