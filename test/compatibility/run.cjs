const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const reference = '/tmp/opencode/cepr-plan3-v0';
const source = path.resolve(root, '../bck-v0');
const suffix = `${Date.now()}`;
const databases = [`cepr_test_v0_${suffix}`, `cepr_test_v1_${suffix}`];
const container = `cepr-reference-${suffix}`;
const referenceDb = `${container}-db`;
const runtimeFile = '/tmp/opencode/cepr-plan3-runtime.json';
const secret = 'test-secret-only-with-at-least-32-bytes';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
function sql(statement) {
  run('docker', ['compose', '-f', 'compose.dev.yaml', 'exec', '-T', 'db', 'psql', '-U', 'cepr', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', statement]);
}
async function main() {
  fs.mkdirSync(reference, { recursive: true });
  const installed = fs.existsSync(path.join(reference, 'node_modules/.prisma/client/index.js')) &&
    fs.existsSync(path.join(reference, 'package-lock.json')) &&
    fs.readFileSync(path.join(reference, 'package-lock.json')).equals(fs.readFileSync(path.join(source, 'package-lock.json')));
  for (const name of ['src', 'package.json', 'package-lock.json', 'tsconfig.json']) {
    fs.cpSync(path.join(source, name), path.join(reference, name), { recursive: true });
  }
  fs.copyFileSync(path.join(__dirname, 'reference.cjs'), path.join(reference, 'reference.cjs'));
  fs.writeFileSync(runtimeFile, JSON.stringify({ version: 1, maintenance: { enabled: false, message: '', endsAt: null }, schemaRouting: { adminSchema: 'alpha_2026', userSchema: 'alpha_2026' } }));
  run('docker', ['run', '--rm', '--user', '1000:1000', '-v', `${reference}:/app`, '-w', '/app', 'node:24.22.0-trixie', 'sh', '-c', `${installed ? '' : 'npm ci --no-audit --no-fund && '}npx prisma generate`]);
  sql(`CREATE DATABASE "${databases[1]}"`);
  const url = (database) => `postgresql://cepr:cepr_dev@127.0.0.1:${database === databases[0] ? 5436 : 5432}/${database}`;
  let server;
  try {
    run('docker', ['run', '-d', '--rm', '--name', referenceDb, '--tmpfs', '/var/lib/postgresql/data', '-p', '127.0.0.1:5436:5432', '-e', 'POSTGRES_USER=cepr', '-e', 'POSTGRES_PASSWORD=cepr_dev', '-e', `POSTGRES_DB=${databases[0]}`, 'postgres:17-alpine']);
    for (let attempt = 0; ; attempt++) {
      if (spawnSync('docker', ['exec', referenceDb, 'pg_isready', '-U', 'cepr', '-d', databases[0]], { stdio: 'ignore' }).status === 0) break;
      if (attempt >= 60) throw new Error('PostgreSQL 17 startup timeout');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    server = spawn('docker', ['run', '--rm', '--name', container, '--network', 'host', '--user', '1000:1000',
      '-v', `${reference}:/app`, '-v', `${runtimeFile}:/runtime.json`, '-w', '/app',
      '-e', `DATABASE_URL=${url(databases[0])}`, '-e', 'PORT=9083', '-e', 'NODE_ENV=test',
      '-e', `JWT_SECRET=${secret}`, '-e', 'GOOGLE_CLIENT_ID=test', '-e', 'GOOGLE_CLIENT_SECRET=test',
      '-e', 'GOOGLE_CALLBACK_URL=http://localhost:9083/api/auth/google/callback',
      '-e', 'TEST_RUNTIME_FILE=/runtime.json', 'node:24.22.0-trixie', 'node', 'reference.cjs'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = fs.createWriteStream('/tmp/opencode/cepr-plan3-reference.log');
    server.stdout.pipe(log);
    server.stderr.pipe(log);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Reference startup timeout; see /tmp/opencode/cepr-plan3-reference.log')), 60000);
      server.stdout.on('data', (chunk) => { if (chunk.toString().includes('REFERENCE_READY')) { clearTimeout(timeout); resolve(); } });
      server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Reference exited ${code}; see reference log`)); });
    });
    run('docker', ['run', '--rm', '--network', 'host', '--user', '1000:1000', '-v', `${root}:/app`,
      '-v', '/tmp/opencode:/tmp/opencode', '-v', `${source}:/reference:ro`, '-w', '/app',
      '-e', `TEST_DATABASE_URL=${url(databases[1])}`, '-e', `REFERENCE_DATABASE_URL=${url(databases[0])}`,
      '-e', 'REFERENCE_URL=http://127.0.0.1:9083', '-e', `TEST_RUNTIME_FILE=${runtimeFile}`,
      '-e', `JWT_SECRET=${secret}`, 'node:24.22.0-trixie', 'npm', 'test', '--', '--runInBand', '--runTestsByPath', 'test/modules.e2e-spec.cjs']);
  } finally {
    if (server) spawnSync('docker', ['stop', '-t', '5', container], { stdio: 'ignore' });
    spawnSync('docker', ['stop', '-t', '5', referenceDb], { stdio: 'ignore' });
    sql(`DROP DATABASE IF EXISTS "${databases[1]}" WITH (FORCE)`);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
