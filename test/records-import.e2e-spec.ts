import { readFileSync } from 'node:fs';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { ClassSessionRecordsService } from '../src/modules/class-session-records/class-session-records.service';
import { SessionJournalService } from '../src/modules/class-session-records/session-journal.service';
import { SessionFilesFixture } from './helpers/session-files-fixtures';
import { installPartTestClock } from './helpers/part-test-clock';

type Row = Record<string,string|null>;
interface ImportedProcess {label:string;tables:Record<string,Row[]>;counts:Record<string,number>}
const suite = process.env.TEST_DATABASE_URL && process.env.RECORDS_IMPORT_MANIFEST ? describe : describe.skip;
suite('Importación aislada del dump por lista blanca anonimizada', () => {
  jest.setTimeout(180000);
  const fixtures:SessionFilesFixture[]=[];
  const tables = ['areas','courses','sedes','shifts','users','supervisors','teachers','monitors','classes','hour_sessions','schedules','area_course_hours'];
  const manifest = process.env.RECORDS_IMPORT_MANIFEST ? JSON.parse(readFileSync(process.env.RECORDS_IMPORT_MANIFEST,'utf8')) as {anonymized:boolean;originalIdsRetained:boolean;processes:ImportedProcess[]} : undefined;
  afterAll(async () => { for (const fixture of fixtures) await fixture.close(); });
  it.each([0,1,2])('instala, importa y materializa el proceso %i sin identidades originales', async index => {
    expect(manifest?.anonymized).toBe(true); expect(manifest?.originalIdsRetained).toBe(false);
    const source=manifest!.processes[index], fixture=new SessionFilesFixture(); fixtures.push(fixture);
    await fixture.initialize();
    await fixture.pg.query('BEGIN');
    try {
      await fixture.pg.query(`SET LOCAL search_path TO "${fixture.schema}"`);
      await fixture.pg.query('TRUNCATE users,areas,courses,sedes,shifts RESTART IDENTITY CASCADE');
      for (const table of tables) {
        const available = await fixture.pg.query<{column_name:string}>(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2`,[fixture.schema,table]);
        const allowed = new Set(available.rows.map(row=>row.column_name));
        for (let offset=0;offset<source.tables[table].length;offset+=200) {
          const batch=source.tables[table].slice(offset,offset+200);
          const columns=Object.keys(batch[0]).filter(column=>allowed.has(column));
          expect(columns.every(column=>/^[a-z_]+$/.test(column))).toBe(true);
          const values=batch.flatMap(row=>columns.map(column=>row[column]));
          await fixture.pg.query(`INSERT INTO "${table}"(${columns.map(column=>`"${column}"`).join(',')}) VALUES ${batch.map((_,i)=>`(${columns.map((_,j)=>'$'+(i*columns.length+j+1)).join(',')})`).join(',')}`,values);
        }
        const count=await fixture.pg.query<{count:number}>(`SELECT count(*)::int count FROM "${table}"`);
        expect(count.rows[0].count).toBe(source.counts[table]);
        const sequence=await fixture.pg.query<{sequence:string|null}>('SELECT pg_get_serial_sequence($1,$2) sequence',[`${fixture.schema}.${table}`,'id']);
        if(sequence.rows[0].sequence) await fixture.pg.query(`SELECT setval($1::regclass,COALESCE((SELECT max(id) FROM "${table}"),1))`,[sequence.rows[0].sequence]);
      }
      await fixture.pg.query(`UPDATE shifts s SET start_time=h.start_time,end_time=h.end_time FROM (SELECT shift_id,min(start_time) start_time,max(end_time) end_time FROM hour_sessions GROUP BY shift_id) h WHERE h.shift_id=s.id`);
      await fixture.pg.query(`INSERT INTO user_profiles(user_id,first_name,last_name) SELECT id,'Persona','Sintética' FROM users`);
      await fixture.pg.query(`UPDATE session_operational_config SET enabled=true,starts_on='2026-01-01',ends_on='2026-12-31' WHERE id=1`);
      const leaks=await fixture.pg.query<{count:number}>(`SELECT count(*)::int count FROM users WHERE email NOT LIKE '%@test.invalid' OR google_id IS NOT NULL OR password IS NOT NULL`);
      expect(leaks.rows[0].count).toBe(0);
      await fixture.pg.query('COMMIT');
    } catch(error) { await fixture.pg.query('ROLLBACK'); throw error; }
    const records=new ClassSessionRecordsService(fixture.apiPrisma as unknown as PrismaService,fixture.context,{assertAvailable:async()=>{}} as unknown as SchemaManagerService);
    const journal=new SessionJournalService(records);
    const clock=await installPartTestClock(fixture.client(),fixture.schema);
    await clock.set(new Date('2026-01-05T15:17:00Z'),0);
    await journal.materialize(fixture.client(),fixture.schema,'2026-01-05');
    await journal.materialize(fixture.client(),fixture.schema,'2026-01-05');
    const count=await fixture.client().classSessionRecord.count();
    expect(count).toBe([833,616,700][index]);
    const duplicates=await fixture.pg.query<{count:number}>(`SELECT count(*)::int count FROM (SELECT date,class_id,hour_session_id FROM "${fixture.schema}".class_session_records GROUP BY date,class_id,hour_session_id HAVING count(*)<>1) d`);
    expect(duplicates.rows[0].count).toBe(0);
    if(index===2) expect(await fixture.client().classSessionRecord.count({where:{supervisorId:null}})).toBe(700);
    console.info(JSON.stringify({process:source.label,classes:source.counts.classes,schedules:source.counts.schedules,materialized:count,anonymized:true}));
  });
});
