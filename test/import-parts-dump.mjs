import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Read-only archive extraction: no SQL, roles, passwords, profiles or functions are executed/imported.
const [archive, output] = process.argv.slice(2);
if (!archive || !output?.startsWith('/tmp/opencode/')) throw new Error('Uso: node test/import-parts-dump.mjs ARCHIVO /tmp/opencode/manifest.json');
const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
if (sha256 !== 'd0ba4586f353e6a8dbaf2b6509291a3d238ce8cf94b0d0d1a367bc849cfc884b') throw new Error('Dump no reconocido; revisar antes de extraer');
const schemas = ['ciclo_quintos_2027', 'ordinario_i_fase_2027', 'ordinario_ii_fase_2027'];
const columns = {
  areas:['id','name'], courses:['id','name'], sedes:['id','name'], shifts:['id','name'],
  users:['id','role','is_active'], supervisors:['id','user_id','shift_id'], teachers:['id','user_id','course_id','max_hours','job_status','is_coordinator'], monitors:['id','user_id','supervisor_id'],
  classes:['id','name','id_sede','area_id','shift_id','monitor_id'], hour_sessions:['id','shift_id','period','start_time','end_time'], schedules:['id','class_id','course_id','hour_session_id','teacher_id','weekday'], area_course_hours:['id','area_id','course_id','total_hours'],
};
const decode = text => text === '\\N' ? null : text.replace(/\\([\\tnr])/g, (_, char) => ({t:'\t',n:'\n',r:'\r','\\':'\\'}[char]));
const processes = schemas.map((schema,index) => {
  const sql = execFileSync('pg_restore', ['--file=-','--data-only','--no-owner','--no-privileges',`--schema=${schema}`, ...Object.keys(columns).map(table => `--table=${table}`),archive], {encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
  const tables = Object.fromEntries(Object.keys(columns).map(table => [table,[]]));
  let table, fields;
  for (const line of sql.split('\n')) {
    const header = line.match(/^COPY ([a-z_0-9]+)\.([a-z_0-9]+) \(([^)]+)\) FROM stdin;$/);
    if (header) { if (header[1] !== schema || !columns[header[2]]) throw new Error('COPY fuera de lista blanca'); table=header[2]; fields=header[3].split(', ').map(field => field.replaceAll('"','')); continue; }
    if (line === '\\.') { table=undefined; continue; }
    if (!table) continue;
    const values=line.split('\t');
    if (values.length !== fields.length) throw new Error('COPY inválido');
    tables[table].push(Object.fromEntries(columns[table].filter(field => fields.includes(field)).map(field => [field,decode(values[fields.indexOf(field)])])));
  }
  const identities = new Map();
  const mapId = value => {
    if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value)) return value;
    if (!identities.has(value)) identities.set(value,randomUUID());
    return identities.get(value);
  };
  for (const [name,rows] of Object.entries(tables)) for (const [i,row] of rows.entries()) {
    for (const key of Object.keys(row)) row[key]=mapId(row[key]);
    if (row.name !== undefined) row.name = `${{areas:'Área',courses:'Curso',sedes:'Sede',shifts:'Turno',classes:'Aula'}[name]} sintético ${i+1}`;
    if (name === 'users') { row.email=`persona-${index+1}-${i+1}@test.invalid`; row.is_active='t'; }
  }
  return {label:`imported_${index+1}`,tables,counts:Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.length]))};
});
const manifest={sourceSha256:sha256,anonymized:true,originalIdsRetained:false,sourceDdlExecuted:false,processes};
writeFileSync(output,JSON.stringify(manifest),{mode:0o600});
console.log(JSON.stringify({sha256,processes:processes.map(({label,counts})=>({label,counts}))}));
