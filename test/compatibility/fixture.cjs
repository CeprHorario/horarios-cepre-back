const { Pool } = require('pg');
const { ConfigService } = require('@nestjs/config');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { DrizzleService } = require('../../src/database/drizzle/drizzle.service');
const { applyStructure } = require('../../src/database/prisma/structure');
const { PrismaService } = require('../../src/database/prisma/prisma.service');
const { RequestContext } = require('../../src/database/schema-manager/request-context');
const fs = require('node:fs');
const path = require('node:path');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const roles = ['administrador', 'profesor', 'monitor', 'supervisor', 'coordinador', 'coordinador-10', 'profesor'];
const tables = ['users', 'user_profiles', 'teachers', 'supervisors', 'monitors', 'areas', 'courses', 'sedes', 'shifts', 'classes', 'hour_sessions', 'area_course_hours', 'schedules'];
const schemas = ['core_schema', 'alpha_2026', 'beta_2026'];
async function fixture(url) {
  const pool = new Pool({ connectionString: url });
  const config = new ConfigService({ DATABASE_URL: url, DB_POOL_MAX: 3 });
  const db = new DrizzleService(config);
  const prisma = new PrismaService(config, new RequestContext());
  await migrate(drizzle(pool), { migrationsFolder: 'src/database/drizzle/migrations' });
  for (const [index, schema] of schemas.entries()) {
    if (url === process.env.REFERENCE_DATABASE_URL) {
      await db.transaction(async (tx) => {
        await tx.query(`CREATE SCHEMA "${schema}"`);
        await tx.query(`SET LOCAL search_path TO "${schema}"`);
        const directory = '/reference/src/database/prisma/migrations';
        for (const version of fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
          await tx.query(fs.readFileSync(path.join(directory, version, 'migration.sql'), 'utf8'));
        }
      });
    } else await db.transaction((tx) => applyStructure(tx, schema, true));
    const p = prisma.getClientForSchema(schema);
    if (index === 0) {
      await p.user.create({ data: { id: id(1), email: 'admin@example.com', role: 'administrador' } });
      continue;
    }
    const offset = (index - 1) * 1000;
    await p.course.createMany({ data: [
      { id: 1, name: 'Razonamiento Verbal' },
      { id: 2, name: 'Razonamiento Matemático' },
      { id: 3, name: 'Razonamiento Lógico' },
      { id: 10, name: `Especial ${schema}` },
    ] });
    await p.area.create({ data: { id: 1, name: 'Extraordinario' } });
    await p.sede.create({ data: { id: 1, name: `Sede ${schema}` } });
    await p.shift.create({ data: { id: 1, name: 'Turno 01', startTime: new Date('1970-01-01T08:00:00Z'), endTime: new Date('1970-01-01T13:10:00Z') } });
    await p.hourSession.createMany({ data: Array.from({ length: 7 }, (_, i) => ({ id: i + 1, shiftId: 1, period: i + 1, startTime: new Date(Date.UTC(1970, 0, 1, 8, 45 * i)), endTime: new Date(Date.UTC(1970, 0, 1, 8, 45 * i + 40)) })) });
    for (let n = 2; n <= 7; n++) {
      await p.user.create({ data: {
        id: id(offset + n), email: `user${n}@example.com`, role: roles[n - 1], isActive: n !== 7,
        userProfile: { create: { id: id(offset + 100 + n), dni: `1000000${n}`, firstName: `Nombre ${n}`, lastName: `Apellido ${n}`, phone: null, phonesAdditional: [] } },
      } });
    }
    await p.teacher.createMany({ data: [
      { id: id(offset + 202), userId: id(offset + 2), courseId: 1, jobStatus: 'FullTime', maxHours: 16, scheduledHours: 1 },
      { id: id(offset + 207), userId: id(offset + 7), courseId: 10, jobStatus: 'PartTime', maxHours: 21, scheduledHours: 0 },
    ] });
    await p.supervisor.create({ data: { id: id(offset + 304), userId: id(offset + 4), shiftId: 1 } });
    await p.monitor.create({ data: { id: id(offset + 403), userId: id(offset + 3), supervisorId: id(offset + 304) } });
    await p.class.createMany({ data: [
      { id: id(offset + 501), name: `Aula ${schema}`, idSede: 1, areaId: 1, shiftId: 1, monitorId: id(offset + 403) },
      { id: id(offset + 502), name: `Libre ${schema}`, idSede: 1, areaId: 1, shiftId: 1 },
    ] });
    await p.areaCourseHour.createMany({ data: [{ id: 1, areaId: 1, courseId: 1, totalHours: 6 }, { id: 2, areaId: 1, courseId: 10, totalHours: 3 }] });
    await p.schedule.createMany({ data: [
      { id: 1, classId: id(offset + 501), courseId: 1, hourSessionId: 1, teacherId: id(offset + 202), weekday: 'Lunes' },
      { id: 2, classId: id(offset + 501), courseId: 1, hourSessionId: 2, weekday: 'Martes' },
      { id: 3, classId: id(offset + 502), courseId: 10, hourSessionId: 3, weekday: 'Miercoles' },
    ] });
    for (const table of ['courses', 'areas', 'sedes', 'shifts', 'hour_sessions', 'area_course_hours', 'schedules']) {
      await pool.query(`SELECT setval(pg_get_serial_sequence('${schema}.${table}', 'id'), (SELECT max(id) FROM "${schema}"."${table}"))`);
    }
    await pool.query('INSERT INTO public.admission_processes (name, year, is_current, structure_version) VALUES ($1, 2026, $2, $3)', [schema, index === 1, 'fixture']);
  }
  // Stable timestamp fixtures; new timestamps are checked and normalized separately.
  for (const schema of schemas) {
    for (const table of ['users', 'user_profiles', 'teachers', 'supervisors', 'monitors']) {
      await pool.query(`UPDATE "${schema}"."${table}" SET created_at = '2026-01-01', updated_at = '2026-01-01'`);
    }
  }
  await db.onModuleDestroy();
  return { pool, prisma, close: async () => { await prisma.onModuleDestroy(); await pool.end(); } };
}

async function snapshot(pool, identities) {
  const state = {};
  for (const schema of schemas) {
    state[schema] = {};
    for (const table of tables) {
      state[schema][table] = (await pool.query(`SELECT * FROM "${schema}"."${table}"`)).rows;
    }
    for (const row of state[schema].users) identities.set(row.id, `${schema}/user/${row.email}`);
    for (const table of ['user_profiles', 'teachers', 'supervisors', 'monitors']) {
      for (const row of state[schema][table]) identities.set(row.id, `${schema}/${table}/${identities.get(row.user_id) || row.dni}`);
    }
    for (const row of state[schema].classes) identities.set(row.id, `${schema}/class/${row.name}`);
  }
  for (const schema of schemas) {
    for (const table of tables) {
      state[schema][table] = normalize(state[schema][table], identities).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }
  }
  return state;
}
function normalize(value, identities, key = '') {
  if (value === null || value === undefined) return value;
  if (/^(createdAt|updatedAt|created_at|updated_at)$/.test(key)) {
    if (!Number.isFinite(new Date(value).getTime())) throw new Error(`Invalid timestamp: ${key}`);
    return '<timestamp>';
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => normalize(v, identities));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, identities, k)]));
  if (typeof value === 'string') {
    return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, (uuid) => identities.get(uuid) || uuid);
  }
  return value;
}
module.exports = { fixture, snapshot, normalize, id, roles };
