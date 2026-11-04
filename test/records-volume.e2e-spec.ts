import { randomUUID } from 'node:crypto';
import { SessionFilesFixture } from './helpers/session-files-fixtures';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { ClassSessionRecordsService } from '../src/modules/class-session-records/class-session-records.service';
import type { PrismaClient } from '../src/generated/prisma/client';

// Opt-in: genera 13 semanas sintéticas (64.974 partes) en una base aislada.
const suite =
  process.env.TEST_DATABASE_URL && process.env.RECORDS_VOLUME === '1'
    ? describe
    : describe.skip;

interface PlanRow {
  'QUERY PLAN': {
    Plan: { 'Actual Total Time': number; 'Actual Rows': number };
    'Execution Time': number;
  }[];
}

suite('Volumen sintético de Partes y planes PostgreSQL', () => {
  jest.setTimeout(300_000);
  const fixture = new SessionFilesFixture(true);
  const teacherId = randomUUID();
  const teacherUserId = randomUUID();
  let otherSupervisorId = '';

  const explain = async (sql: string) => {
    const result = await fixture.pg.query<PlanRow>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    );
    const plan = result.rows[0]['QUERY PLAN'][0];
    return {
      ms: plan['Execution Time'],
      rows: plan.Plan['Actual Rows'],
      time: plan.Plan['Actual Total Time'],
    };
  };

  beforeAll(async () => {
    await fixture.initialize();
    await fixture.pg.query(`SET search_path TO "${fixture.schema}"`);
    const supervisor = await fixture.pg.query<{ id: string }>(
      `SELECT id FROM supervisors WHERE user_id=$1`,
      [fixture.principals.otherSupervisor.userId],
    );
    otherSupervisorId = supervisor.rows[0].id;
    await fixture.pg.query(
      `INSERT INTO users(id,email,role) VALUES($1,$2,'profesor')`,
      [teacherUserId, 'volume-teacher@test.invalid'],
    );
    await fixture.pg.query(
      `INSERT INTO teachers(id,user_id,course_id,job_status) VALUES($1,$2,1,'PART_TIME')`,
      [teacherId, teacherUserId],
    );
    // Un monitor por aula, como el dump: 119 cuentas distintas, no una compartida.
    await fixture.pg.query(
      `INSERT INTO users(id,email,role)
       SELECT uuidv7(),'volume-monitor-'||g||'@test.invalid','monitor'
       FROM generate_series(1,119) g`,
    );
    await fixture.pg.query(
      `INSERT INTO monitors(id,user_id,supervisor_id)
       SELECT uuidv7(),u.id,$1 FROM users u WHERE u.email LIKE 'volume-monitor-%'`,
      [fixture.supervisorId],
    );
    await fixture.pg.query(
      `INSERT INTO hour_sessions(id,shift_id,period,start_time,end_time)
       SELECT g,1,g,(time '08:00'+((g-1)*interval '50 minutes')),
         (time '08:00'+((g-1)*interval '50 minutes')+interval '40 minutes')
       FROM generate_series(2,7) g`,
    );
    await fixture.pg.query(
      `WITH m AS (
        SELECT m.id,row_number() OVER(ORDER BY u.email) rn
        FROM monitors m JOIN users u ON u.id=m.user_id
        WHERE u.email LIKE 'volume-monitor-%')
       UPDATE classes c SET monitor_id=m.id FROM m WHERE m.rn=1`,
    );
    await fixture.pg.query(
      `WITH m AS (
        SELECT m.id,row_number() OVER(ORDER BY u.email) rn
        FROM monitors m JOIN users u ON u.id=m.user_id
        WHERE u.email LIKE 'volume-monitor-%')
       INSERT INTO classes(id,name,id_sede,area_id,shift_id,monitor_id)
       SELECT uuidv7(),'Aula volumen '||g,1,1,1,m.id
       FROM generate_series(2,119) g JOIN m ON m.rn=g`,
    );
    await fixture.pg.query(
      `INSERT INTO class_session_records(
        date,class_id,hour_session_id,shift_id,area_id,course_id,
        scheduled_start,scheduled_end,shift_end,edit_deadline,period,
        pedagogical_minutes,titular_teacher_id,titular_monitor_id,
        monitor_account_id,supervisor_id,snapshot,timing_policy)
      SELECT days.day::date,c.id,h.id,1,1,1,
        (days.day::date+h.start_time) AT TIME ZONE 'America/Lima',
        (days.day::date+h.end_time) AT TIME ZONE 'America/Lima',
        (days.day::date+time '14:40') AT TIME ZONE 'America/Lima',
        (days.day::date+time '16:10') AT TIME ZONE 'America/Lima',
        h.period,40,$1,c.monitor_id,m.user_id,
        CASE WHEN c.rn<=14 THEN $2::uuid ELSE $3::uuid END,
        jsonb_build_object('className',c.name,'course','Curso volumen','area','Area','shift','Shift'),
        '{}'::jsonb
      FROM (SELECT date '2026-01-05'+(w*7+d) AS day
        FROM generate_series(0,12) w, generate_series(0,5) d) days
      CROSS JOIN (SELECT c.id,c.name,c.monitor_id,row_number() OVER(ORDER BY c.id) rn
        FROM classes c) c
      JOIN monitors m ON m.id=c.monitor_id
      CROSS JOIN hour_sessions h`,
      [teacherId, otherSupervisorId, fixture.supervisorId],
    );
    await fixture.pg.query('ANALYZE class_session_records');
    await fixture.pg.query('ANALYZE classes');
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('mide jornada de siete bloques, histórico, supervisor de 14 aulas y administrador de 119', async () => {
    const count = await fixture.pg.query<{ total: number }>(
      `SELECT count(*)::int total FROM class_session_records`,
    );
    expect(count.rows[0].total).toBe(78 * 119 * 7);
    const classResult = await fixture.pg.query<{ id: string }>(
      `SELECT id FROM classes ORDER BY name LIMIT 1`,
    );
    const selectedClass = classResult.rows[0].id;
    const monitor = await fixture.pg.query<{ user_id: string }>(
      `SELECT m.user_id FROM classes c JOIN monitors m ON m.id=c.monitor_id WHERE c.id=$1`,
      [selectedClass],
    );
    const monitorUserId = monitor.rows[0].user_id;
    const day = '2026-02-02';
    const workspace = await explain(`SELECT r.* FROM v_class_session_records_workspace r
      WHERE r.deleted_at IS NULL AND r.date='${day}'::date AND r.class_id='${selectedClass}'::uuid
        AND r.shift_id=1 AND r.monitor_account_id='${monitorUserId}'::uuid
      ORDER BY r.scheduled_start,r.period,r.id`);
    expect(workspace.rows).toBe(7);
    const monitorHistory = await explain(`SELECT r.id FROM class_session_records r
      WHERE r.monitor_account_id='${monitorUserId}'::uuid AND r.deleted_at IS NULL
        AND r.date BETWEEN '2026-01-05'::date AND '2026-04-04'::date`);
    expect(monitorHistory.rows).toBe(78 * 7);
    const supervisor = await explain(`SELECT r.id FROM class_session_records r
      WHERE r.supervisor_id='${otherSupervisorId}'::uuid AND r.deleted_at IS NULL
        AND r.date BETWEEN '2026-01-05'::date AND '2026-02-02'::date`);
    expect(supervisor.rows).toBeGreaterThan(0);
    const admin = await explain(`SELECT r.id FROM class_session_records r
      WHERE r.deleted_at IS NULL AND r.date='${day}'::date`);
    expect(admin.rows).toBe(119 * 7);
    // La salida es la evidencia reproducible; no se afirma latencia productiva.
    console.info(
      JSON.stringify({
        parts: count.rows[0].total,
        workspace: { blocks: workspace.rows, ms: workspace.ms },
        monitorHistory: { ms: monitorHistory.ms },
        supervisor14: { ms: supervisor.ms },
        admin119: { ms: admin.ms },
      }),
    );
  });
  it('cuenta SQL, JSON y memoria de A con siete y 105 filas, sin N+1', async () => {
    const records = new ClassSessionRecordsService(
      fixture.apiPrisma as unknown as PrismaService,
      fixture.context,
      { assertAvailable: async () => {} } as unknown as SchemaManagerService,
    );
    const selectedClass = (
      await fixture.pg.query<{ id: string }>(
        `SELECT id FROM classes ORDER BY name LIMIT 1`,
      )
    ).rows[0].id;
    const monitor = await fixture.pg.query<{
      user_id: string;
      email: string;
      monitor_id: string;
    }>(
      `SELECT m.id monitor_id,m.user_id,u.email FROM classes c JOIN monitors m ON m.id=c.monitor_id JOIN users u ON u.id=m.user_id WHERE c.id=$1`,
      [selectedClass],
    );
    const principal = {
      ...fixture.principals.monitor,
      userId: monitor.rows[0].user_id,
      email: monitor.rows[0].email,
    };
    // Cuenta operaciones Prisma de esta consulta sin depender de logs globales del servicio.
    let prismaQueries = 0;
    const unscoped = fixture.prisma.getClientForSchema.bind(
      fixture.prisma,
    ) as (schema: string) => PrismaClient;
    fixture.prisma.getClientForSchema = (schema: string) => {
      const client = unscoped(schema);
      if (schema !== fixture.schema) return client;
      const extended = client.$extends({
        query: {
          $allOperations: ({ args, query }) => {
            prismaQueries++;
            return query(args);
          },
        },
      });
      return extended as unknown as PrismaClient;
    };
    const measure = async (date: string) => {
      prismaQueries = 0;
      const started = performance.now(),
        before = process.memoryUsage();
      const workspace = await fixture.context.run(
        {
          schema: fixture.schema,
          routing: { adminSchema: fixture.schema, userSchema: fixture.schema },
        },
        () =>
          records.workspace(principal, {
            date,
            classId: selectedClass,
            shiftId: 1,
          }),
      );
      return {
        rows: workspace.rows.length,
        queries: prismaQueries,
        jsonBytes: Buffer.byteLength(JSON.stringify(workspace)),
        ms: performance.now() - started,
        heapDelta: process.memoryUsage().heapUsed - before.heapUsed,
      };
    };
    const seven = await measure('2026-02-02');
    await fixture.pg.query(
      `INSERT INTO hour_sessions(id,shift_id,period,start_time,end_time) SELECT g,1,g,time '08:00',time '08:40' FROM generate_series(8,105) g`,
    );
    await fixture.pg.query(
      `INSERT INTO class_session_records(date,class_id,hour_session_id,shift_id,area_id,course_id,scheduled_start,scheduled_end,shift_end,edit_deadline,period,pedagogical_minutes,titular_teacher_id,titular_monitor_id,monitor_account_id,supervisor_id,snapshot,timing_policy)
       SELECT date '2026-04-06',$1,h.id,1,1,1,timestamptz '2026-04-06 13:00Z',timestamptz '2026-04-06 13:40Z',timestamptz '2026-04-06 13:40Z',timestamptz '2026-04-06 15:10Z',h.period,40,$2,$3,$4,$5,'{}'::jsonb,'{}'::jsonb FROM hour_sessions h`,
      [
        selectedClass,
        teacherId,
        monitor.rows[0].monitor_id,
        principal.userId,
        fixture.supervisorId,
      ],
    );
    const large = await measure('2026-04-06');
    expect(seven.rows).toBe(7);
    expect(large.rows).toBe(105);
    expect(large.queries).toBe(seven.queries);
    console.info(JSON.stringify({ endpoint: 'A', seven, large }));
  });
});
