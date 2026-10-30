import type { Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { SessionFilesService } from '../src/modules/session-files/session-files.service';
import { createRecordsBrowserHarness } from './helpers/records-browser-harness';
import { pngFixture } from './helpers/session-files-fixtures';

const mode = process.env.RECORDS_BROWSER_HARNESS;
const suite = mode === 'smoke' ? describe : describe.skip;
const frontend =
  process.env.RECORDS_BROWSER_FRONTEND_ORIGIN ?? 'http://127.0.0.1:5174';
suite('Harness local de navegador (solo Compose)', () => {
  jest.setTimeout(120000);
  it('rechaza producción y destinos fuera de Compose antes de crear fixtures', async () => {
    for (const [key, value] of [
      ['NODE_ENV', 'production'],
      [
        'TEST_DATABASE_URL',
        'postgresql://cepr:local-only@external.invalid:5432/cepr_records_test',
      ],
      ['STORAGE_EMULATOR_HOST', 'https://storage.googleapis.com'],
    ]) {
      const original = process.env[key];
      process.env[key] = value;
      try {
        await expect(createRecordsBrowserHarness()).rejects.toThrow(
          'Harness exclusivo',
        );
      } finally {
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      }
    }
  });
  it('ejecuta smoke real de cookie, partes, archivos, revisión y aislamiento', async () => {
    const harness = await createRecordsBrowserHarness();
    try {
      const agent = request.agent(harness.app.getHttpServer() as Server);
      const get = (path: string) => agent.get(path).set('Origin', frontend);
      const post = (path: string) =>
        agent
          .post(path)
          .set('Origin', frontend)
          .set('X-Requested-With', 'ceprunsa');
      const patch = (path: string) =>
        agent
          .patch(path)
          .set('Origin', frontend)
          .set('X-Requested-With', 'ceprunsa');
      const session = (role: string) =>
        get(`/__test/session?role=${role}`).expect(200);
      const { a, b } = harness.manifest.processes;
      const root = '/api/class-session-records';
      const body = <T>(response: request.Response) => response.body as T;
      const preflight = await agent
        .options(`${root}/1`)
        .set('Origin', frontend)
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          'content-type,x-requested-with,x-class-session-context,x-class-session-account',
        )
        .expect(204);
      expect(preflight.headers['access-control-allow-origin']).toBe(frontend);
      expect(preflight.headers['access-control-allow-credentials']).toBe(
        'true',
      );
      expect(
        String(preflight.headers['access-control-allow-headers']).toLowerCase(),
      ).toContain('x-class-session-context');
      expect(
        String(preflight.headers['access-control-allow-headers']).toLowerCase(),
      ).toContain('x-class-session-account');
      await get('/api/system/status').expect(200, {
        maintenance: false,
        message: 'Mantenimiento ficticio para pruebas',
        endsAt: null,
      });
      await get(`${root}/context`).expect(401);
      for (const role of ['monitor', 'supervisor', 'admin']) {
        const signedIn = await session(role);
        expect(signedIn.headers['set-cookie']).toEqual(
          expect.arrayContaining([
            expect.stringContaining('HttpOnly'),
          ]) as unknown,
        );
        expect(Object.keys(body<object>(signedIn))).toEqual([
          'authenticated',
          'role',
        ]);
        const user = body<{ id: string; role: string }>(
          await get('/api/auth/user-info').expect(200),
        );
        const context = body<{ accountId: string; process: string }>(
          await get(`${root}/context`).expect(200),
        );
        expect(context.accountId).toBe(user.id);
        expect(context.process).toBe(a.process);
      }
      await get('/api/classes').expect(200);
      await get('/api/hour-sessions').expect(200);
      await session('monitor');
      await agent
        .post('/__test/maintenance?enabled=false')
        .set('Origin', 'http://127.0.0.1:5173')
        .set('X-Requested-With', 'ceprunsa')
        .expect(403);
      const forbiddenOrigin = await agent
        .options(`${root}/1`)
        .set('Origin', 'http://127.0.0.1:5173')
        .set('Access-Control-Request-Method', 'POST');
      expect(
        forbiddenOrigin.headers['access-control-allow-origin'],
      ).toBeUndefined();
      await get('/api/classes').expect(401);
      const contextResponse = await get(`${root}/context`).expect(200);
      expect(contextResponse.headers['cache-control']).toBe(
        'private, no-store',
      );
      expect(contextResponse.headers['access-control-allow-origin']).toBe(
        frontend,
      );
      const agenda = body<{ total: number }>(
        await get(`${root}/agenda?date=${harness.manifest.date}`).expect(200),
      );
      expect(agenda.total).toBe(6);
      await get(`${root}/${a.records.editable}/people?kind=TEACHER`).expect(
        200,
      );
      await agent
        .patch(`${root}/${a.records.editable}`)
        .send({ expectedVersion: 1 })
        .expect(403);
      const uploaded = body<{ id: string; status: string }>(
        await post(`/api/class-session-files/records/${a.records.editable}`)
          .attach('file', pngFixture(), {
            filename: 'smoke.png',
            contentType: 'image/png',
          })
          .expect(201),
      );
      expect(uploaded.status).toBe('AVAILABLE');
      const content = await get(
        `/api/class-session-files/${uploaded.id}/content`,
      ).expect(200);
      expect(content.body).toEqual(pngFixture());
      const attached = body<{ version: number }>(
        await post(
          `/api/class-session-files/records/${a.records.editable}/captures/initial`,
        )
          .send({ fileId: uploaded.id, expectedVersion: 1 })
          .expect(201),
      );
      expect(attached.version).toBe(2);
      await session('admin');
      const oldAccount = harness.manifest.accounts.monitor.accountId;
      await get(`${root}/${a.records.editable}`)
        .set('X-Class-Session-Context', a.process)
        .set('X-Class-Session-Account', oldAccount)
        .expect(409);
      await post(`${root}/${a.records.editable}/corrections`)
        .set('X-Class-Session-Context', a.process)
        .set('X-Class-Session-Account', oldAccount)
        .send({
          expectedVersion: 2,
          incidents: 'Borrador de la cuenta anterior',
          reason: 'No ejecutar tras cambiar cookie',
        })
        .expect(409);
      await get(`/api/class-session-files/${uploaded.id}/content`)
        .set('X-Class-Session-Account', oldAccount)
        .expect(409);
      const currentAccount = harness.manifest.accounts.admin.accountId;
      expect(
        body<{ accountId: string }>(
          await get(`${root}/context`)
            .set('X-Class-Session-Account', oldAccount)
            .expect(200),
        ).accountId,
      ).toBe(currentAccount);
      const sameRecord = body<{ version: number }>(
        await get(`${root}/${a.records.editable}`)
          .set('X-Class-Session-Account', currentAccount)
          .expect(200),
      );
      expect(sameRecord.version).toBe(2);
      await session('monitor');
      await post(`/__test/concurrent?recordId=${a.records.editable}`).expect(
        200,
      );
      await patch(`${root}/${a.records.editable}`)
        .send({ expectedVersion: 2, incidents: 'Borrador obsoleto' })
        .expect(409);
      await patch(`${root}/${a.records.closed}`)
        .send({ expectedVersion: 1, incidents: 'Cerrado' })
        .expect(403);
      await session('supervisor');
      await post(`${root}/${a.records.closed}/reviews`)
        .send({
          expectedVersion: 1,
          result: 'OBSERVED',
          comments: 'Prueba de revisión tras cierre',
          confirmed: true,
        })
        .expect(201);
      await session('admin');
      const pending = body<{ version: number; coverages: { id: number }[] }>(
        await get(`${root}/${a.records.pendingReplacement}`).expect(200),
      );
      await post(`${root}/replacements/${pending.coverages[0].id}/resolve`)
        .send({
          expectedVersion: pending.version,
          status: 'AUTHORIZED',
          reason: 'Autorizar cobertura ficticia',
        })
        .expect(201);
      const grant = body<{ id: number }>(
        await post(`${root}/${a.records.closed}/grants`)
          .send({
            expectedVersion: 1,
            accountId: harness.manifest.accounts.monitor.accountId,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            reason: 'Habilitación ficticia smoke',
          })
          .expect(201),
      );
      await session('monitor');
      await patch(`${root}/${a.records.closed}`)
        .send({ expectedVersion: 1, incidents: 'Edición con habilitación' })
        .expect(200);
      await session('admin');
      await post(`${root}/grants/${grant.id}/revoke`)
        .send({ expectedVersion: 2, reason: 'Revocación ficticia smoke' })
        .expect(201);
      await post(`${root}/${a.records.closed}/corrections`)
        .send({
          expectedVersion: 2,
          incidents: 'Corrección extraordinaria ficticia',
          reason: 'Verificar corrección administrativa',
        })
        .expect(201);
      await post('/__test/process?process=b&audience=admin').expect(200);
      await get(`${root}/${b.records.editable}`)
        .set('X-Class-Session-Context', a.process)
        .expect(409);
      await post(`${root}/${b.records.closed}/corrections`)
        .set('X-Class-Session-Context', a.process)
        .send({
          expectedVersion: 1,
          incidents: 'No debe cruzar procesos',
          reason: 'Contexto anterior al cambio runtime',
        })
        .expect(409);
      const unchanged = body<{ version: number; incidents: string | null }>(
        await get(`${root}/${b.records.closed}`)
          .set('X-Class-Session-Context', b.process)
          .expect(200),
      );
      expect(unchanged.version).toBe(1);
      expect(unchanged.incidents).toBeNull();
      const evidence = body<{ initialFileId: string }>(
        await get(`${root}/${b.records.evidence}`)
          .set('X-Class-Session-Context', b.process)
          .expect(200),
      );
      await get(`/api/class-session-files/${evidence.initialFileId}/content`)
        .set('X-Class-Session-Context', a.process)
        .expect(409);
      await post(`/api/class-session-files/records/${b.records.editable}`)
        .set('X-Class-Session-Context', a.process)
        .attach('file', pngFixture(), {
          filename: 'contexto-obsoleto.png',
          contentType: 'image/png',
        })
        .expect(409);
      expect(
        body<{ process: string }>(
          await get(`${root}/context`)
            .set('X-Class-Session-Context', a.process)
            .expect(200),
        ).process,
      ).toBe(b.process);
      await session('monitor');
      expect(
        body<{ process: string }>(await get(`${root}/context`).expect(200))
          .process,
      ).toBe(a.process);
      await post('/__test/process?process=b&audience=user').expect(200);
      await get(`${root}/context`).expect(401);
      await session('monitor');
      expect(
        body<{ process: string }>(await get(`${root}/context`).expect(200))
          .process,
      ).toBe(b.process);
      await post(
        `/__test/close?process=b&recordId=${b.records.editable}`,
      ).expect(200);
      await patch(`${root}/${b.records.editable}`)
        .send({ expectedVersion: 1, incidents: 'Cierre adelantado' })
        .expect(403);
      await post('/__test/maintenance?enabled=true').expect(200);
      await get('/api/system/status').expect(200, {
        maintenance: true,
        message: 'Mantenimiento ficticio para pruebas',
        endsAt: null,
      });
      await get(`${root}/context`).expect(503);
      await session('admin');
      await get(`${root}/context`).expect(200);
      await post('/__test/maintenance?enabled=false').expect(200);
      await session('teacher');
      await get(`${root}/context`).expect(401);
      await session('otherMonitor');
      await get(`${root}/${b.records.editable}`).expect(404);
      await session('monitor');
      await post('/api/auth/logout').expect(201);
      await get('/api/auth/user-info').expect(401);
      await agent
        .get('/__test/fixtures')
        .set('Origin', 'https://example.invalid')
        .expect(403);
      await get('/api/auth/google').expect(404);
      console.info(
        'Smoke del harness correcto: cookies/CSRF/CORS, roles/procesos, PNG/GCS, conflictos, cierre, habilitación, revisión, cobertura y mantenimiento.',
      );
    } finally {
      await harness.close();
    }
  });
  it('retiene solo la respuesta de la próxima subida 5, ejecuta GCS una vez y la libera tras mantenimiento', async () => {
    const harness = await createRecordsBrowserHarness();
    try {
      const agent = request.agent(harness.app.getHttpServer() as Server);
      const get = (path: string) => agent.get(path).set('Origin', frontend);
      const post = (path: string) =>
        agent
          .post(path)
          .set('Origin', frontend)
          .set('X-Requested-With', 'ceprunsa');
      const body = <T>(response: request.Response) => response.body as T;
      const upload = (id: number) =>
        post(`/api/class-session-files/records/${id}`).attach(
          'file',
          pngFixture(),
          { filename: 'retenida.png', contentType: 'image/png' },
        );
      await get('/__test/session?role=monitor').expect(200);
      await get('/__test/held-upload').expect(200, { held: false });
      await post('/__test/hold-upload?enabled=true').expect(200, {
        enabled: true,
      });
      // Another record must not consume the one-shot hold.
      await upload(1).expect(201);
      const files = jest.spyOn(harness.app.get(SessionFilesService), 'upload');
      let received = false;
      const pending = upload(5).then((response) => {
        received = true;
        return response;
      });
      let status: { held: boolean; status?: number } = { held: false };
      for (let attempt = 0; attempt < 250; attempt++) {
        status = body(await get('/__test/held-upload').expect(200));
        if (status.held) break;
        await delay(20);
      }
      expect(status).toEqual({ held: true, status: 201 });
      expect(received).toBe(false);
      expect(files).toHaveBeenCalledTimes(1);
      const stored = await (files.mock.results[0].value as ReturnType<
        SessionFilesService['upload']
      >);
      expect(stored.status).toBe('AVAILABLE');
      await post('/__test/hold-upload?enabled=true').expect(409);
      await post('/__test/maintenance?enabled=true').expect(200);
      await get('/api/class-session-records/context').expect(503);
      await get('/__test/held-upload').expect(200, { held: true, status: 201 });
      expect(received).toBe(false);
      await post('/__test/release-upload').expect(200, { released: true });
      const delivered = await pending;
      expect(delivered.status).toBe(201);
      expect(body<{ id: string; status: string }>(delivered)).toMatchObject({
        id: stored.id,
        status: 'AVAILABLE',
      });
      expect(files).toHaveBeenCalledTimes(1);
      await get('/__test/held-upload').expect(200, { held: false });
      await post('/__test/release-upload').expect(200, { released: false });
      await post('/__test/maintenance?enabled=false').expect(200);
      const bytes = await get(
        `/api/class-session-files/${stored.id}/content`,
      ).expect(200);
      expect(bytes.body).toEqual(pngFixture());
      expect(
        body<{ initialFileId: string | null }>(
          await get('/api/class-session-records/5').expect(200),
        ).initialFileId,
      ).toBeNull();
      await upload(5).expect(201);
      expect(files).toHaveBeenCalledTimes(2);
    } finally {
      await harness.close();
    }
  });
});
