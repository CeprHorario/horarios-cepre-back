// Real distroless + PostgreSQL + official Firestore emulator; no Nest overrides.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { Firestore } = require('@google-cloud/firestore');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { DrizzleService } = require('../../dist/database/drizzle/drizzle.service');
const { applyStructure } = require('../../dist/database/prisma/structure');
const ExcelJS = require('exceljs');
const stateFile = '/tmp/opencode/cepr-plan3-smoke.json';
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  assert.equal(result.status, 0, command);
}
function sql(statement) {
  run('docker', ['compose', '-f', 'compose.dev.yaml', 'exec', '-T', 'db', 'psql', '-U', 'cepr', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', statement]);
}
function cleanup(state) {
  spawnSync('docker', ['stop', '-t', '5', state.container], { stdio: 'ignore' });
  try { process.kill(state.emulatorPid, 'SIGTERM'); } catch { /* already stopped */ }
  assert.match(state.database, /^cepr_smoke_\d+$/);
  sql(`DROP DATABASE IF EXISTS "${state.database}" WITH (FORCE)`);
  fs.rmSync(stateFile, { force: true });
}
async function ready(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Startup timed out: ${url}`);
}
async function main() {
  if (process.argv.includes('--cleanup')) return cleanup(JSON.parse(fs.readFileSync(stateFile, 'utf8')));
  const jar = process.env.FIRESTORE_EMULATOR_JAR || '/tmp/opencode/cloud-firestore-emulator-v1.22.0.jar';
  assert.equal(createHash('sha256').update(fs.readFileSync(jar)).digest('hex'), '9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c');
  const database = `cepr_smoke_${Date.now()}`;
  const container = database.replaceAll('_', '-');
  const url = `postgresql://cepr:cepr_dev@127.0.0.1:5432/${database}`;
  const secret = 'test-secret-only-with-at-least-32-bytes';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:9085';
  const emulatorLog = fs.openSync('/tmp/opencode/cepr-plan3-firestore.log', 'w');
  const emulator = spawn('java', ['-jar', jar, '--host', '127.0.0.1', '--port', '9085', '--project_id', 'demo-cepr-plan3'], { detached: true, stdio: ['ignore', emulatorLog, emulatorLog] });
  emulator.unref();
  const state = { database, container, emulatorPid: emulator.pid };
  let pool, firestore;
  let keep = false;
  try {
    await ready('http://127.0.0.1:9085');
    sql(`CREATE DATABASE "${database}"`);
    pool = new Pool({ connectionString: url });
    await migrate(drizzle(pool), { migrationsFolder: 'src/database/drizzle/migrations' });
    const db = new DrizzleService(new ConfigService({ DATABASE_URL: url, DB_POOL_MAX: 2 }));
    await db.transaction((tx) => applyStructure(tx, 'core_schema', true));
    await db.onModuleDestroy();
    const adminId = '00000000-0000-4000-8000-000000000001';
    await pool.query("INSERT INTO core_schema.users (id, email, role) VALUES ($1, 'admin@example.com', 'administrador')", [adminId]);
    await pool.query("INSERT INTO core_schema.user_profiles (user_id, first_name, last_name) VALUES ($1, 'Admin', 'Migración')", [adminId]);
    firestore = new Firestore({ projectId: 'demo-cepr-plan3' });
    await firestore.doc('system_config/runtime').set({ version: 1, maintenance: { enabled: false, message: 'Disponible', endsAt: null }, schemaRouting: { adminSchema: 'core_schema', userSchema: 'core_schema' }, updatedAt: null, updatedBy: { id: adminId, email: 'admin@example.com' }, changeReason: 'Smoke fixture' });
    const jwt = new JwtService({ secret, signOptions: { algorithm: 'HS256', issuer: 'cepr', audience: 'cepr-api', expiresIn: '1h' } });
    const sign = (user, schema = 'smokealpha_2026') => jwt.sign({ id: user.id, email: user.email, role: user.role, schema });
    const admin = sign({ id: adminId, email: 'admin@example.com', role: 'administrador' }, 'core_schema');
    const base = 'http://127.0.0.1:9084';
    run('docker', ['run', '-d', '--rm', '--name', container, '--network', 'host',
      '-e', `DATABASE_URL=${url}`, '-e', 'PORT=9084', '-e', 'REDIRECT_FRONT=http://127.0.0.1:5174',
      '-e', `JWT_SECRET=${secret}`, '-e', 'GOOGLE_CLIENT_ID=test', '-e', 'GOOGLE_CLIENT_SECRET=test',
      '-e', 'GOOGLE_REDIRECT_URI=http://127.0.0.1:9084/api/auth/google/redirect',
      '-e', 'GOOGLE_CLOUD_PROJECT=demo-cepr-plan3', '-e', 'FIRESTORE_EMULATOR_HOST=127.0.0.1:9085',
      process.env.TEST_IMAGE || 'cepr-plan3-check']);
    await ready(`${base}/api/health`);
    async function http(method, path, body, token = admin, status = 200) {
      const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
      return result;
    }
    await http('POST', '/auth/sync-authorizations', {}, admin, 201);
    const admission = { year: 2026, sede: 'Sede Virtual', started: '2026-01-01', finished: '2026-12-31' };
    await http('POST', '/admissions', { ...admission, name: 'smokealpha', configuration: { emailDomain: '@example.com', createSchedules: true, shifts: [{ name: 'Turno 01', startTime: '08:00', endTime: '13:10', classesToAreas: [{ area: 'Extraordinario', quantityClasses: 1 }] }] } }, admin, 201);
    await http('POST', '/admissions', { ...admission, name: 'smokebeta' }, admin, 201);
    await http('POST', '/admissions/current', { name: 'smokealpha_2026' });
    let config = await http('GET', '/system/runtime-config');
    const change = async (schemaRouting = config.schemaRouting, enabled = false) => {
      config = await http('PATCH', '/system/runtime-config', { expectedVersion: config.version, schemaRouting, maintenance: { enabled, message: enabled ? 'Mantenimiento de prueba' : 'Disponible', endsAt: null }, changeReason: 'Smoke test' });
    };
    await change({ adminSchema: 'smokealpha_2026', userSchema: 'smokealpha_2026' });
    const courses = await http('GET', '/courses');
    const courseId = courses.find((course) => course.name === 'Razonamiento Verbal').id;
    await http('POST', '/teachers', { email: 'teacher@example.com', dni: '12345678', firstName: 'Docente', lastName: 'Prueba', jobStatus: 'FullTime', courseId, maxHours: 60, scheduledHours: 0, isCoordinator: false }, admin, 201);
    const teacher = (await http('GET', '/teachers')).data[0];
    const classes = await http('GET', '/classes');
    await http('PATCH', '/schedules/asignar/profesor', { classroomIds: [classes[0].id], teacherId: teacher.id });
    const teacherUser = (await pool.query('SELECT id, email, role FROM smokealpha_2026.users WHERE email = $1', ['teacher@example.com'])).rows[0];
    const teacherToken = sign(teacherUser);
    assert.equal((await http('GET', '/auth/user-info', undefined, teacherToken)).role, 'profesor');
    assert.equal((await http('GET', '/classes/getClassOfTeacher', undefined, teacherToken)).length, 1);
    const monitor = (await pool.query('SELECT id, email, role FROM smokealpha_2026.users WHERE role = $1', ['monitor'])).rows[0];
    const monitorToken = sign(monitor);
    await http('PUT', `/monitors/${classes[0].monitorId}`, { firstName: 'Monitor', lastName: 'Prueba' });
    await http('GET', '/monitors/information', undefined, monitorToken);
    await http('POST', '/supervisors', { email: 'supervisor@example.com', dni: '12345679', firstName: 'Supervisor', lastName: 'Prueba', shift_id: 1 }, admin, 201);
    const supervisor = (await http('GET', '/supervisors')).data[0];
    await http('PATCH', '/supervisors/assignMonitor', { id_monitor: classes[0].monitorId, id_supervisor: supervisor.id });
    const supervisorUser = (await pool.query('SELECT id, email, role FROM smokealpha_2026.users WHERE email = $1', ['supervisor@example.com'])).rows[0];
    const supervisorToken = sign(supervisorUser);
    assert.equal((await http('GET', '/supervisors/getMonitors', undefined, supervisorToken)).length, 1);
    const coordinator = await http('POST', '/coordinators', { email: 'coordinator@example.com', dni: '12345670', firstName: 'Coordinador', lastName: 'Prueba', courseId }, admin, 201);
    const coordinatorToken = sign(coordinator);
    await http('GET', '/teachers', undefined, coordinatorToken);
    const createdClass = await http('POST', '/classes', { area_id: 1, shift_id: 1 }, admin, 201);
    assert.equal(createdClass.id[14], '7');
    const publicSchedule = await http('GET', '/schedules/public/teachers?email=teacher@example.com&dni=12345678', undefined, null);
    assert.ok(publicSchedule.horarios.length > 0);
    const exported = await fetch(`${base}/api/teachers/export`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(exported.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Docentes_Ceprunsa', 'Horas_por_salon']);
    await change({ adminSchema: 'smokebeta_2026', userSchema: 'smokealpha_2026' });
    assert.deepEqual(await http('GET', '/courses'), []);
    assert.equal((await http('GET', '/classes/getClassOfTeacher', undefined, teacherToken)).length, 1);
    await change({ adminSchema: 'smokebeta_2026', userSchema: 'smokebeta_2026' });
    await http('GET', '/auth/user-info', undefined, teacherToken, 401);
    await change({ adminSchema: 'smokealpha_2026', userSchema: 'smokealpha_2026' }, true);
    await http('GET', '/classes/getClassOfTeacher', undefined, teacherToken, 503);
    await http('GET', '/schedules/public/teachers', undefined, null, 503);
    await http('GET', '/courses');
    await change();
    const concurrent = { expectedVersion: config.version, schemaRouting: config.schemaRouting, maintenance: config.maintenance, changeReason: 'Concurrent version' };
    const writes = await Promise.all([1, 2].map(() => fetch(`${base}/api/system/runtime-config`, { method: 'PATCH', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify(concurrent) })));
    assert.deepEqual(writes.map((response) => response.status).sort(), [200, 409]);
    config = await http('GET', '/system/runtime-config');
    assert.ok((await http('GET', '/system/runtime-config/history')).length > 0);
    run('docker', ['restart', container]);
    await ready(`${base}/api/health`);
    assert.equal((await http('GET', '/system/runtime-config')).version, config.version);
    assert.equal((await http('GET', '/classes/getClassOfTeacher', undefined, teacherToken)).length, 1);
    state.tokens = { admin, teacher: teacherToken, monitor: monitorToken, supervisor: supervisorToken, coordinator: coordinatorToken };
    fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
    console.log('PASS: distroless provisioning, people, real JWT guards, assignments, all roles, Excel, schema isolation, maintenance, concurrent Firestore versions and restart.');
    keep = process.argv.includes('--keep');
  } finally {
    await pool?.end();
    await firestore?.terminate();
    if (!keep) cleanup(state);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
