// E2/E3: solo fixture sintético del harness exclusivo. Nunca acepta schemas por argumento.
const { Pool } = require('pg');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  const inspecting = process.argv[2] === 'inspect';
  const requests = process.argv[2] === 'requests';
  const generating = process.argv[2] === 'generator';
  const count = inspecting || requests || generating ? 0 : Number(process.argv[2] ?? 61);
  if (process.env.NODE_ENV !== 'test' || url.hostname !== 'db' || url.pathname !== '/cepr_records_test' || !Number.isInteger(count) || count < 0 || count > 100)
    throw new Error('Solo Compose de pruebas y 0–100 candidatos');
  const response = await fetch('http://127.0.0.1:3000/__test/fixtures');
  if (!response.ok) throw new Error('Harness no disponible');
  const fixture = await response.json();
  const schema = fixture.processes.a.process;
  if (!/^sr_[a-f0-9]{32}_a$/.test(schema)) throw new Error('Schema no pertenece al fixture');
  const pool = new Pool({ connectionString: url.toString() });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`SET LOCAL search_path TO "${schema}",public`);
    if (generating) {
      await db.query("INSERT INTO sedes(id,name) SELECT (SELECT COALESCE(max(id),0)+1 FROM sedes),'Sede Virtual' WHERE NOT EXISTS(SELECT 1 FROM sedes WHERE name='Sede Virtual')");
      await db.query('COMMIT');
      console.log(JSON.stringify({ ok: true, fixture: 'catálogo de sede válido para DTO existente' }));
      return;
    }
    if (requests) {
      const user = await db.query("INSERT INTO users(email,role) VALUES('e3-request-candidate@test.invalid','profesor') ON CONFLICT(email) DO UPDATE SET is_active=true RETURNING id");
      await db.query("INSERT INTO user_profiles(user_id,first_name,last_name,dni,phones_additional) VALUES($1,'Candidato','Solicitud sintetica','97000001',ARRAY[]::varchar[]) ON CONFLICT(user_id) DO NOTHING", [user.rows[0].id]);
      const teacher = await db.query("INSERT INTO teachers(user_id,course_id,max_hours,job_status) VALUES($1,1,40,'PART_TIME') ON CONFLICT(user_id) DO UPDATE SET max_hours=40 RETURNING id", [user.rows[0].id]);
      await db.query('DELETE FROM teacher_availabilities WHERE teacher_id=$1', [teacher.rows[0].id]);
      await db.query(`INSERT INTO teacher_availabilities(teacher_id,weekday,start_minute,end_minute) SELECT $1,day,0,1440 FROM unnest(enum_range(NULL::"Weekday")) day`, [teacher.rows[0].id]);
      await db.query('COMMIT');
      console.log(JSON.stringify({ ok: true, fixture: 'candidato libre sintético para solicitudes', teacherId: teacher.rows[0].id }));
      return;
    }
    if (inspecting) {
      const result = await db.query(`SELECT t.id,t.scheduled_hours AS "scheduledHours",(SELECT count(*)::int FROM schedules s WHERE s.teacher_id=t.id) AS actual FROM teachers t ORDER BY t.id`);
      await db.query('COMMIT');
      console.log(JSON.stringify({ ok: true, teachers: result.rows }));
      return;
    }
    await db.query(`INSERT INTO users(email,role)
      SELECT 'final-candidate-'||lpad(g::text,3,'0')||'@test.invalid','profesor' FROM generate_series(1,100) g
      ON CONFLICT(email) DO NOTHING`);
    await db.query(`INSERT INTO user_profiles(user_id,first_name,last_name,phones_additional)
      SELECT id,'Candidato',substring(email from 17 for 3),ARRAY[]::varchar[] FROM users WHERE email LIKE 'final-candidate-%@test.invalid'
      ON CONFLICT(user_id) DO NOTHING`);
    await db.query(`INSERT INTO teachers(user_id,course_id,max_hours,job_status)
      SELECT id,1,20,'PART_TIME' FROM users WHERE email LIKE 'final-candidate-%@test.invalid' ON CONFLICT(user_id) DO NOTHING`);
    // La carga histórica del harness no era parte de sus pruebas de horario semanal.
    // Preparar explícitamente este fixture coherente sin reparar datos de aplicación.
    await db.query('UPDATE schedules SET teacher_id=$1 WHERE class_id=$2 AND course_id=1', [fixture.ids.teacher, fixture.classId]);
    await db.query(`UPDATE teachers t SET scheduled_hours=(SELECT count(*) FROM schedules s WHERE s.teacher_id=t.id)`);
    await db.query(`DELETE FROM teacher_availabilities WHERE teacher_id IN (SELECT t.id FROM teachers t JOIN users u ON u.id=t.user_id WHERE u.email LIKE 'final-candidate-%@test.invalid') OR teacher_id=ANY($1::uuid[])`, [[fixture.ids.teacher, fixture.ids.replacementTeacher]]);
    await db.query(`INSERT INTO teacher_availabilities(teacher_id,weekday,start_minute,end_minute)
      SELECT t.id,day,0,1440 FROM teachers t JOIN users u ON u.id=t.user_id
      CROSS JOIN unnest(enum_range(NULL::"Weekday")) day
      WHERE u.email IN (SELECT email FROM users WHERE email LIKE 'final-candidate-%@test.invalid' ORDER BY email LIMIT $1) OR t.id=$2`, [count, fixture.ids.teacher]);
    await db.query('COMMIT');
    console.log(JSON.stringify({ ok: true, candidates: count, process: schema, fixture: 'semana sintética; Partes sin cambios' }));
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
