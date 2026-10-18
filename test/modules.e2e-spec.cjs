const fs = require('node:fs');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const { DiscoveryService, MetadataScanner } = require('@nestjs/core');
const { PATH_METADATA, METHOD_METADATA } = require('@nestjs/common/constants');
const { RequestMethod } = require('@nestjs/common');
const ExcelJS = require('exceljs');
const { AppModule } = require('../src/app.module');
const { configureApp } = require('../src/app.setup');
const { RuntimeConfigService } = require('../src/modules/runtime-config/runtime-config.service');
const { SyncAuthorizationService } = require('../src/modules/auth/sync-authorization.service');
const { fixture, snapshot, normalize, id, roles } = require('./compatibility/fixture.cjs');
const inventory = require('./compatibility/v0-contract.json');

const suite = process.env.REFERENCE_URL ? describe : describe.skip;
suite('Plan 3: real v0/v1 HTTP and independent PostgreSQL databases', () => {
  let app, databases, base, jwt;
  let runtime = { version: 1, maintenance: { enabled: false, message: '', endsAt: null }, schemaRouting: { adminSchema: 'alpha_2026', userSchema: 'alpha_2026' } };
  const identities = [new Map(), new Map()];
  const checked = [];
  const token = (user = 1, schema = 'alpha_2026') => jwt.sign({ id: id(user), email: user === 1 ? 'admin@example.com' : `user${user}@example.com`, role: roles[user - 1], schema: user === 1 ? 'core_schema' : schema });
  async function http(version, method, path, body, user = 1) {
    if (version === 0) {
      const reverse = new Map([...identities[0]].map(([uuid, key]) => [key, uuid]));
      const translate = (value) => value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, (uuid) => reverse.get(identities[1].get(uuid)) || uuid);
      path = translate(path);
      if (body !== undefined) body = JSON.parse(translate(JSON.stringify(body)));
    }
    const response = await fetch(`${version === 0 ? process.env.REFERENCE_URL : base}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const contentType = response.headers.get('content-type') || '';
    return { status: response.status, body: contentType.includes('json') ? await response.json() : contentType.includes('spreadsheet') ? Buffer.from(await response.arrayBuffer()) : await response.text(), headers: response.headers };
  }
  async function states() {
    const results = await Promise.all(databases.map((db, i) => snapshot(db.pool, identities[i])));
    expect(results[1]).toEqual(results[0]);
    return results;
  }
  async function compare(method, path, body, user = 1, status) {
    const responses = await Promise.all([0, 1].map((v) => http(v, method, path, body, user)));
    await states();
    expect({ method, path, status: responses[1].status }).toEqual({ method, path, status: responses[0].status });
    if (status) expect({ method, path, status: responses[1].status, ...(responses[1].status !== status ? { body: responses[1].body } : {}) }).toEqual({ method, path, status });
    expect(normalize(responses[1].body, identities[1])).toEqual(normalize(responses[0].body, identities[0]));
    checked.push({ method, path, user, status: responses[1].status });
    return responses[1].body;
  }
  beforeAll(async () => {
    databases = await Promise.all([process.env.REFERENCE_DATABASE_URL, process.env.TEST_DATABASE_URL].map(fixture));
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RuntimeConfigService).useValue({ getCurrent: async () => runtime }).compile();
    app = module.createNestApplication({ logger: ['error'] });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    jwt = app.get(JwtService);
    await states();
  }, 120000);
  afterAll(async () => {
    fs.writeFileSync('/tmp/opencode/cepr-plan3-checked.json', JSON.stringify(checked, null, 2));
    await app?.close();
    await Promise.all((databases || []).map((db) => db.close()));
  });

  it('registers every inventoried endpoint in the real Nest application', () => {
    const routes = [];
    for (const { instance, metatype } of app.get(DiscoveryService).getControllers()) {
      if (!instance || !metatype) continue;
      const prefix = Reflect.getMetadata(PATH_METADATA, metatype);
      for (const name of new MetadataScanner().getAllMethodNames(Object.getPrototypeOf(instance))) {
        const method = Reflect.getMetadata(METHOD_METADATA, instance[name]);
        if (method === undefined) continue;
        const path = '/api/' + [prefix, Reflect.getMetadata(PATH_METADATA, instance[name])].join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
        routes.push(`${RequestMethod[method]} ${path}`);
      }
    }
    for (const endpoint of inventory.endpoints) expect(routes).toContain(`${endpoint.method} ${endpoint.path.replace(/\/$/, '')}`);
  });

  it('preserves read contracts, pagination, relations, static routes and course restrictions', async () => {
    for (const path of [
      '/areas', '/areas/1', '/courses', '/courses/1', '/sedes', '/sedes/1', '/shifts', '/shifts/1',
      '/hour-sessions', '/hour-sessions/1', '/area-course-hours', '/area-course-hours/1',
      '/users', '/users?page=1&limit=2', '/users?page=0&limit=0', '/user-profiles', `/user-profiles/${id(102)}`,
      '/teachers', '/teachers?page=1&limit=0', '/teachers?page=1&limit=-1', '/teachers?courseId=10',
      '/teachers/search?query=Apellido&limit=0', '/teachers/by-course/1', `/teachers/${id(202)}`, `/teachers/${id(202)}/schedules`,
      '/coordinators', `/coordinators/${id(6)}`, '/supervisors', `/supervisors/${id(304)}`, `/supervisors/${id(304)}/monitors`,
      '/monitors', '/monitors?shift_id=1&area_id=1', '/monitors/filtered?has_supervisor=true&shiftId=1',
      '/monitors/filtered?has_supervisor=false', '/monitors/search?query=Apellido&limit=0', `/monitors/${id(403)}`,
      `/monitors/${id(3)}/horario`, `/monitors/${id(3)}/teachers`, '/classes', `/classes/${id(501)}`,
      `/classes/${id(501)}/schedules`, `/classes/${id(501)}/teachers`, '/schedules', '/schedules/1',
    ]) await compare('GET', path, undefined, 1, 200);
    await compare('GET', '/classes/getClassOfTeacher', undefined, 2, 200);
    await compare('GET', '/monitors/information', undefined, 3, 200);
    await compare('GET', '/monitors/cargar/horario', undefined, 3, 200);
    await compare('GET', '/monitors/datos/teachers', undefined, 3, 200);
    await compare('GET', '/supervisors/getMonitors', undefined, 4, 200);
    for (const user of [5, 6]) {
      for (const path of ['/courses', '/teachers', '/schedules', '/classes', '/area-course-hours']) await compare('GET', path, undefined, user, 200);
    }
    await compare('GET', '/courses/1', undefined, 6, 403);
    await compare('GET', '/teachers/by-course/1', undefined, 6, 403);
    await compare('GET', `/teachers/${id(202)}`, undefined, 6, 404);
    await compare('GET', '/schedules/public/teachers?email=user2@example.com&dni=10000002', undefined, null, 200);
    await compare('GET', '/schedules/public/teachers?email=user7@example.com&dni=10000007', undefined, null, 404);
    await compare('POST', '/teachers/available', { courseId: 1, hourSessions: [{ hourSessionId: 3, weekday: 'Viernes' }] }, 1, 200);
    await compare('GET', `/schedules/salones/disponibles?course_id=1&page=1&pageSize=10&horario=${encodeURIComponent(JSON.stringify([{ id_hour_session: 2, weekday: 'Martes' }]))}`, undefined, 1, 200);
  }, 120000);

  it('preserves validation, not-found and foreign-key/unique error contracts', async () => {
    for (const [method, path, body, status] of [
      ['GET', '/users?page=nope', undefined, 200], ['GET', '/courses/not-an-id', undefined, 400],
      ['GET', '/courses/999', undefined, 404], ['GET', '/hour-sessions/999', undefined, 400],
      ['GET', '/schedules/public/teachers', undefined, 404], ['GET', '/schedules/public/teachers?email=invalid&dni=1', undefined, 400],
      ['POST', '/areas', { name: 'Extraordinario' }, 409], ['POST', '/areas', { name: 'Valid', unknown: true }, 400],
      ['POST', '/shifts', { name: 'Invalid', startTime: '08:00:00', endTime: '08:41:00' }, 400],
      ['POST', '/shifts', { name: 'Invalid', startTime: '08:00:00', endTime: '07:00:00' }, 400],
      ['PUT', '/area-course-hours/999', { totalHours: 4 }, 404],
      ['POST', '/area-course-hours', { areaId: 1, courseId: 999, totalHours: 4 }, 400],
      ['DELETE', '/areas/1', undefined, 400], ['DELETE', '/courses/1', undefined, 400],
      ['DELETE', '/sedes/1', undefined, 400], ['DELETE', '/shifts/1', undefined, 400],
      ['PATCH', '/schedules/asignar/profesor', { classroomIds: [], teacherId: id(202) }, 400],
      ['PATCH', '/supervisors/assignMonitor', { id_monitor: id(999), id_supervisor: null }, 404],
    ]) await compare(method, path, body, 1, status);
  }, 120000);

  it('preserves writes, nulls, nested people creation, imports and assignment counters', async () => {
    const area = await compare('POST', '/areas', { name: 'Nueva', description: null }, 1, 201);
    await compare('PUT', `/areas/${area.id}`, { description: '' }, 1, 200);
    await compare('POST', '/courses', { name: 'Nuevo', color: '#000000' }, 1, 201);
    await compare('PUT', '/courses/11', { name: 'Nuevo', color: '#ffffff' }, 1, 200);
    await compare('POST', '/sedes', { name: 'Nueva' }, 1, 201);
    await compare('PUT', '/sedes/2', { description: '' }, 1, 200);
    await compare('POST', '/area-course-hours', { areaId: area.id, courseId: 11, totalHours: 0 }, 1, 400);
    const hours = await compare('POST', '/area-course-hours', { areaId: area.id, courseId: 11, totalHours: 1 }, 1, 201);
    await compare('PUT', `/area-course-hours/${hours.id}`, { totalHours: 4 }, 1, 200);
    await compare('POST', '/shifts', { name: 'Turno 02', startTime: '14:00:00', endTime: '15:25:00' }, 1, 201);
    const sessions = (await databases[1].prisma.getClientForSchema('alpha_2026').hourSession.findMany({ where: { shiftId: 2 }, orderBy: { period: 'asc' } }));
    expect(sessions.map((row) => [row.period, row.startTime.toISOString(), row.endTime.toISOString(), row.durationMinutes])).toEqual([[1, '1970-01-01T14:00:00.000Z', '1970-01-01T14:40:00.000Z', 40], [2, '1970-01-01T14:45:00.000Z', '1970-01-01T15:25:00.000Z', 40]]);
    await compare('POST', '/hour-sessions', { shiftId: 2, period: 3, startTime: '15:30:00', endTime: '16:10:00' }, 1, 201);
    await compare('PUT', '/hour-sessions/10', { shiftId: 2, period: 3, startTime: '16:00:00', endTime: '16:40:00' }, 1, 200);
    await compare('POST', '/users', { email: 'new-monitor@example.com', role: 'monitor' }, 1, 201);
    await compare('POST', '/users/create-many', [{ email: 'new-super@example.com', role: 'supervisor' }], 1, 201);
    const teacher = { email: 'new-teacher@example.com', dni: '20000001', firstName: 'Nueva', lastName: 'Docente', courseId: 10, maxHours: 0, scheduledHours: 0, isCoordinator: false, jobStatus: 'PartTime', phonesAdditional: [], personalEmail: null };
    await compare('POST', '/teachers', teacher, 1, 201);
    await compare('POST', '/teachers', teacher, 1, 409);
    await compare('POST', '/teachers', { ...teacher, email: 'duplicate-dni@example.com' }, 1, 409);
    const imported = Array.from({ length: 6 }, (_, n) => ({ email: `import${n}@example.com`, dni: `3000000${n}`, firstName: 'Import', lastName: `Batch ${n}`, courseId: n < 2 ? 10 : 1, jobStatus: n % 2 ? 'PartTime' : 'FullTime', isCoordinator: n >= 4 }));
    const result = await compare('POST', '/teachers/json', [...imported, teacher], 1, 201);
    expect(result.creados).toHaveLength(6);
    expect(result.noCreados).toEqual([{ email: teacher.email, dni: teacher.dni, motivo: 'email duplicado' }]);
    const created = await databases[1].prisma.getClientForSchema('alpha_2026').teacher.findMany({ where: { user: { email: { startsWith: 'import' } } }, orderBy: { user: { email: 'asc' } } });
    expect(created.map((row) => row.maxHours)).toEqual([16, 21, 16, 20, 12, 16]);
    await compare('POST', '/teachers/json', imported, 1, 201);
    await compare('POST', '/coordinators', { email: 'coord@example.com', dni: '40000001', firstName: 'Nuevo', lastName: 'Coord', courseId: 10 }, 1, 201);
    await compare('PUT', `/coordinators/${id(6)}`, { courseId: null, phone: null, phonesAdditional: [] }, 1, 200);
    await compare('PUT', `/coordinators/${id(6)}`, { courseId: 10 }, 1, 200);
    await compare('POST', '/supervisors', { email: 'super@example.com', dni: '40000002', firstName: 'Nuevo', lastName: 'Super', shift_id: 1 }, 1, 201);
    await compare('PUT', `/supervisors/${id(304)}`, { phone: '123456789', shift_id: 2 }, 1, 200);
    await compare('PATCH', '/supervisors/assignMonitor', { id_monitor: id(403), id_supervisor: null }, 1, 200);
    await compare('PATCH', '/supervisors/assignMonitor', { id_monitor: id(403), id_supervisor: id(304) }, 1, 200);
    await compare('PUT', `/monitors/${id(403)}`, { firstName: 'Actualizado', lastName: 'Apellido', phone: null }, 1, 200);
    await compare('PATCH', `/classes/${id(501)}/meet-link`, { urlMeet: 'https://meet.google.com/aaa-bbbb-ccc' }, 3, 200);
    await compare('PATCH', `/classes/${id(501)}/classroom-link`, { urlClassroom: null }, 3, 200);
    await compare('PATCH', '/schedules/asignar/profesor', { classroomIds: [id(501)], teacherId: id(202) }, 1, 200);
    expect((await databases[1].prisma.getClientForSchema('alpha_2026').teacher.findUnique({ where: { id: id(202) } })).scheduledHours).toBe(2);
    await compare('PATCH', '/schedules/desasignar/profesor', { classroomIds: [id(501)], teacherId: id(202) }, 1, 200);
    expect((await databases[1].prisma.getClientForSchema('alpha_2026').teacher.findUnique({ where: { id: id(202) } })).scheduledHours).toBe(0);
    await compare('DELETE', `/area-course-hours/${hours.id}`, undefined, 1, 204);
    await compare('DELETE', '/courses/11', undefined, 1, 200);
    await compare('DELETE', `/areas/${area.id}`, undefined, 1, 204);
    await compare('DELETE', '/sedes/2', undefined, 1, 204);
  }, 120000);

  it('compares Excel sheets, cells, order, totals and HTTP headers', async () => {
    for (const user of [1, 6]) {
      const responses = await Promise.all([0, 1].map((v) => http(v, 'GET', '/teachers/export', undefined, user)));
      const sheets = [];
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
        expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="docentes_ceprunsa_\d{4}-\d{2}-\d{2}\.xlsx"$/);
        expect(Number(response.headers.get('content-length'))).toBe(response.body.length);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(response.body);
        sheets.push(workbook.worksheets.map((sheet) => ({ name: sheet.name, rows: sheet.getSheetValues(), columns: sheet.columns.map((column) => column.width) })));
      }
      expect(sheets[1]).toEqual(sheets[0]);
      checked.push({ method: 'GET', path: '/teachers/export', user, status: 200, excel: true });
    }
  });

  it('covers remaining academic mutations and legacy no-op authorization', async () => {
    await compare('POST', '/schedules/load-with-courses', {}, 1, 401);
    await compare('PUT', `/classes/${id(501)}`, { capacity: 0, urlMeet: null }, 1, 400);
    await compare('PUT', `/classes/${id(501)}`, { capacity: 90, urlMeet: null }, 1, 200);
    const schedule = await compare('POST', '/schedules', { classId: id(502), courseId: 1, hourSessionId: 7, weekday: 'Sabado' }, 1, 201);
    await compare('PUT', `/schedules/${schedule.id}`, { weekday: 'Domingo', teacherId: null }, 1, 200);
    await compare('DELETE', `/schedules/${schedule.id}`, undefined, 1, 204);
    await compare('PUT', '/shifts/2', { name: 'Tarde', startTime: '14:00:00', endTime: '15:25:00' }, 1, 200);
    await compare('DELETE', '/hour-sessions/10', undefined, 1, 204);
    await compare('POST', `/supervisors/${id(304)}/updateProfile`, { firstName: 'Supervisor' }, 1, 200);
    await compare('PUT', `/teachers/${id(202)}`, { firstName: 'Docente', lastName: 'Apellido', isCoordinator: false, maxHours: 16 }, 1, 200);
    await compare('PATCH', `/teachers/${id(207)}/deactivate`, {}, 1, 200);
    await compare('DELETE', `/teachers/${id(207)}`, undefined, 1, 200);
    const user = await compare('POST', '/users', { email: 'bare@example.com', role: 'profesor' }, 1, 201);
    await compare('POST', '/monitors', { userId: user.id, supervisorId: null }, 1, 400);
    const monitor = await compare('POST', '/monitors', { userId: user.id, supervisorId: id(304), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }, 1, 201);
    expect(monitor.id[14]).toBe('7');
    await compare('PATCH', `/monitors/${monitor.id}/deactivate`, {}, 1, 200);
    await compare('DELETE', `/monitors/${monitor.id}`, undefined, 1, 200);
    await compare('PATCH', `/coordinators/${id(5)}/deactivate`, {}, 1, 200);
    await compare('POST', '/user-profiles', { dni: '50000001', firstName: 'Admin', lastName: 'Profile', phonesAdditional: [], isActive: true }, 1, 404);
    await compare('PATCH', `/user-profiles/${id(107)}`, { phone: null, phonesAdditional: [] }, 1, 200);
    await compare('PATCH', `/user-profiles/${id(107)}/deactivate`, {}, 1, 200);
    await compare('DELETE', `/user-profiles/${id(107)}`, undefined, 1, 200);
    const superRow = await databases[1].prisma.getClientForSchema('alpha_2026').supervisor.findFirst({ where: { users: { email: 'super@example.com' } } });
    await compare('PATCH', `/supervisors/${superRow.id}/deactivate`, {}, 1, 200);
    await compare('DELETE', `/supervisors/${superRow.id}`, undefined, 1, 200);
  }, 120000);

  it('preserves effective grants including the three shared schedule operations', async () => {
    const sync = await app.get(SyncAuthorizationService).syncAuthorization();
    expect(sync.data.filter((row) => row.permission === 'schedule.delete')).toHaveLength(3);
    for (const user of [2, 3, 4, 6]) {
      await compare('POST', '/courses', { name: 'Denied', color: '#000000' }, user, 401);
      await compare('GET', '/users', undefined, user, 401);
    }
    for (const db of databases) {
      await db.pool.query("INSERT INTO public.roles (id, name) VALUES (1000, 'profesor') ON CONFLICT (name) DO NOTHING");
      await db.pool.query("INSERT INTO public.permissions (name, path, method_http) VALUES ('users.list', 'api/users', 'GET') ON CONFLICT (name) DO NOTHING");
      await db.pool.query("INSERT INTO public.roles_permissions (role_id, permission_id) SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.name = 'profesor' AND p.name = 'users.list' ON CONFLICT DO NOTHING");
    }
    // users has no ORDER BY: the UUIDv4/v7 index scan can change page membership.
    await compare('GET', '/users?page=0&limit=1', undefined, 2, 200);
    const inactive = await http(1, 'GET', '/courses', undefined, 7);
    expect(inactive.status).toBe(401); // Explicit Plan 2 security correction.
  }, 120000);

  it('keeps all protected academic routes behind real guards before validation', async () => {
    const academic = new Set(['areas', 'courses', 'sedes', 'area-course-hours', 'shifts', 'hour-sessions', 'users', 'user-profiles', 'teachers', 'coordinators', 'supervisors', 'monitors', 'classes', 'schedules']);
    for (const endpoint of inventory.endpoints) {
      if (endpoint.public || !academic.has(endpoint.path.split('/')[2])) continue;
      const path = endpoint.path.slice(4).replace(/:[^/]+/g, id(999));
      const response = await http(1, endpoint.method, path, undefined, null);
      expect({ method: endpoint.method, path: endpoint.path, status: response.status }).toEqual({ method: endpoint.method, path: endpoint.path, status: 401 });
    }
  }, 30000);

  it('creates template classrooms with nested UUIDv7 links and deletes their dependent records', async () => {
    const current = await compare('POST', '/classes', { area_id: 1, shift_id: 1 }, 1, 201);
    const p = databases[1].prisma.getClientForSchema('alpha_2026');
    const classroom = await p.class.findUnique({ where: { id: current.id }, include: { monitor: { include: { user: true } }, schedules: true } });
    expect(classroom.name).toBe('E-103-Extraordinario');
    expect(classroom.monitor.user.email).toBe('103e@cepr.unsa.pe');
    expect(classroom.schedules).toHaveLength(36);
    for (const uuid of [classroom.id, classroom.monitor.id, classroom.monitor.user.id]) expect(uuid[14]).toBe('7');
    await compare('DELETE', `/classes/${classroom.id}`, undefined, 1, 204);
    expect(await p.schedule.count({ where: { classId: classroom.id } })).toBe(0);
    expect(await p.user.findUnique({ where: { id: classroom.monitor.user.id } })).toBeNull();
  });

  it('isolates SQL availability, public queries and administrator preparation across processes', async () => {
    runtime = { ...runtime, version: 2, schemaRouting: { adminSchema: 'beta_2026', userSchema: 'alpha_2026' } };
    fs.writeFileSync(process.env.TEST_RUNTIME_FILE, JSON.stringify(runtime));
    await compare('GET', '/courses', undefined, 1, 200);
    await compare('GET', '/courses', undefined, 3, 200);
    await compare('POST', '/teachers/available', { courseId: 1, hourSessions: [{ hourSessionId: 3, weekday: 'Viernes' }] }, 1, 200);
    await compare('GET', '/schedules/public/teachers?email=user2@example.com&dni=10000002', undefined, null, 200);
    await compare('POST', '/areas', { name: 'Only beta' }, 1, 201);
    runtime = { ...runtime, version: 3, maintenance: { enabled: true, message: 'En mantenimiento', endsAt: null } };
    fs.writeFileSync(process.env.TEST_RUNTIME_FILE, JSON.stringify(runtime));
    await compare('GET', '/courses', undefined, 1, 200);
    await compare('GET', '/courses', undefined, 3, 503);
    await compare('GET', '/schedules/public/teachers', undefined, null, 503);
    runtime = { ...runtime, version: 4, maintenance: { enabled: false, message: '', endsAt: null }, schemaRouting: { adminSchema: 'alpha_2026', userSchema: 'alpha_2026' } };
    fs.writeFileSync(process.env.TEST_RUNTIME_FILE, JSON.stringify(runtime));
  }, 120000);

  it('detects the legacy concurrent overwrite and requires consistent assignment counters in v1', async () => {
    const outcomes = [];
    for (const version of [0, 1]) {
      const db = databases[version];
      const p = db.prisma.getClientForSchema('alpha_2026');
      await p.user.create({ data: { id: id(800), email: 'concurrent@example.com', role: 'profesor', teacher: { create: { id: id(801), courseId: 1, maxHours: 16, scheduledHours: 0, jobStatus: 'FullTime' } } } });
      await p.schedule.updateMany({ where: { classId: id(501) }, data: { teacherId: null } });
      await p.teacher.update({ where: { id: id(202) }, data: { scheduledHours: 0 } });
      const lock = await db.pool.connect();
      await lock.query('BEGIN');
      await lock.query('LOCK TABLE alpha_2026.schedules IN SHARE MODE');
      const requests = [id(202), id(801)].map((teacherId) => http(version, 'PATCH', '/schedules/asignar/profesor', { classroomIds: [id(501)], teacherId }));
      try {
        // Both writers are held in PostgreSQL after their reads, not by timing HTTP.
        for (let attempt = 0; attempt < 100; attempt++) {
          const result = await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
          if (result.rows[0].n >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      } finally {
        await lock.query('COMMIT');
        lock.release();
      }
      const responses = await Promise.all(requests);
      const rows = await db.pool.query('SELECT t.id, t.scheduled_hours, count(s.id)::int AS actual FROM alpha_2026.teachers t LEFT JOIN alpha_2026.schedules s ON s.teacher_id = t.id WHERE t.id = ANY($1::uuid[]) GROUP BY t.id', [[id(202), id(801)]]);
      outcomes.push({ statuses: responses.map((r) => r.status).sort(), consistent: rows.rows.every((r) => r.scheduled_hours === r.actual) });
    }
    expect(outcomes[0]).toEqual({ statuses: [200, 200], consistent: false });
    expect(outcomes[1]).toEqual({ statuses: [200, 400], consistent: true });
  }, 30000);
});
