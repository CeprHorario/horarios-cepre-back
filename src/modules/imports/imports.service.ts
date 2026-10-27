import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DrizzleService } from '@database/drizzle/drizzle.service';
import { RequestContext } from '@database/schema-manager/request-context';
import { assertSchemaName } from '@database/schema-manager/schema-name';
import type { PoolClient } from 'pg';
import ExcelJS from 'exceljs';
import { formatTemplate } from './template-format';
import { normalizeIntervals } from '@modules/schedules/availability';
import {
  headers,
  plain,
  readImport,
  type ImportKind,
  type RawRow,
} from './workbook';

interface UserRow {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  dni: string | null;
  personal_email: string | null;
  supervisor_shift_id: number | null;
}
interface ClassRow {
  id: string;
  name: string;
  turno: string;
  shift_id: number;
  monitor_id: string | null;
  user_id: string | null;
  supervisor_id: string | null;
}
interface TeacherRow {
  id: string;
  user_id: string;
  email: string;
}
interface Catalog {
  users: UserRow[];
  teachers: TeacherRow[];
  classes: ClassRow[];
  courses: { id: number; name: string }[];
  sessions: { start: string; end: string; turno: string }[];
}
interface ResolvedRow extends RawRow {
  errors: string[];
  email: string;
  user_id?: string;
  teacher_id?: string;
  class_id?: string;
  monitor_id?: string;
  shift_id?: number;
  weekday?: string;
  start_minute?: number;
  end_minute?: number;
  dni?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  phones_additional?: string[];
  personal_email?: string;
  course_id?: number;
  job_status?: string;
  max_hours?: number;
}
const DAYS: Record<string, string> = {
  lunes: 'MONDAY',
  martes: 'TUESDAY',
  miercoles: 'WEDNESDAY',
  jueves: 'THURSDAY',
  viernes: 'FRIDAY',
  sabado: 'SATURDAY',
  domingo: 'SUNDAY',
};
const minute = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const emailValid = (email: string) =>
  email.length <= 48 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

@Injectable()
export class ImportsService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly context: RequestContext,
  ) {}

  private schema() {
    const schema = this.context.require().schema;
    if (!schema) throw new BadRequestException('No hay proceso seleccionado');
    assertSchemaName(schema);
    return schema;
  }

  private async catalog(db: PoolClient): Promise<Catalog> {
    const users = await db.query<UserRow>(
      'SELECT u.id, u.email, u.role, u.is_active, p.dni, p.personal_email,sp.shift_id AS supervisor_shift_id FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id LEFT JOIN supervisors sp ON sp.user_id=u.id',
    );
    const teachers = await db.query<TeacherRow>(
      'SELECT t.id, t.user_id, u.email FROM teachers t JOIN users u ON u.id=t.user_id WHERE u.is_active',
    );
    const classes = await db.query<ClassRow>(
      'SELECT c.id,c.name,c.shift_id,s.name AS turno,c.monitor_id,m.user_id,m.supervisor_id FROM classes c JOIN shifts s ON s.id=c.shift_id LEFT JOIN monitors m ON m.id=c.monitor_id',
    );
    const courses = await db.query<{ id: number; name: string }>(
      'SELECT id,name FROM courses',
    );
    const sessions = await db.query<{
      start: string;
      end: string;
      turno: string;
    }>(
      `SELECT to_char(h.start_time,'HH24:MI') AS start,to_char(h.end_time,'HH24:MI') AS end,s.name AS turno FROM hour_sessions h JOIN shifts s ON s.id=h.shift_id ORDER BY h.start_time`,
    );
    return {
      users: users.rows,
      teachers: teachers.rows,
      classes: classes.rows,
      courses: courses.rows,
      sessions: sessions.rows,
    };
  }

  private resolve(
    kind: ImportKind,
    raw: RawRow[],
    catalog: Catalog,
  ): ResolvedRow[] {
    const users = new Map(catalog.users.map((u) => [plain(u.email), u]));
    const usersById = new Map(catalog.users.map((u) => [u.id, u]));
    const dnis = new Map(
      catalog.users.filter((u) => u.dni).map((u) => [u.dni!, u.id]),
    );
    const personalEmails = new Map(
      catalog.users
        .filter((u) => u.personal_email)
        .map((u) => [plain(u.personal_email!), u.id]),
    );
    const teachers = new Map(catalog.teachers.map((t) => [plain(t.email), t]));
    const courses = new Map(catalog.courses.map((c) => [plain(c.name), c.id]));
    const classroomMap = new Map<string, ClassRow[]>();
    for (const cls of catalog.classes)
      for (const name of new Set([
        plain(cls.name),
        plain(cls.name.split(' ')[0]),
      ])) {
        const key = `${name}|${plain(cls.turno)}`;
        classroomMap.set(key, [...(classroomMap.get(key) ?? []), cls]);
      }
    const seen = new Map<string, number>();
    const identities = new Map<string, string>();
    const dniOwners = new Map<string, string>();
    const personalOwners = new Map<string, string>();
    return raw.map((row) => {
      const v = row.values;
      const result: ResolvedRow = {
        ...row,
        email: plain(v.correo ?? ''),
        errors: [],
      };
      const error = (message: string) => result.errors.push(message);
      if (kind !== 'monitores' && !emailValid(result.email))
        error('Correo de acceso inválido (máximo 48 caracteres)');
      const existing = users.get(result.email);
      const teacher = teachers.get(result.email);
      const isTime =
        kind === 'disponibilidad' || kind === 'retirar-disponibilidad';
      if (isTime || kind === 'desasignaciones') {
        if (!teacher)
          error('No existe un docente activo con ese correo en este proceso');
        result.teacher_id = teacher?.id;
      }
      if (isTime) {
        result.weekday = DAYS[plain(v.dia ?? '')];
        if (!result.weekday) error('Día inválido; usa Lunes a Domingo');
        const scope = plain(v.alcance ?? '') || 'rango';
        if (!['rango', 'turno completo', 'todo el dia'].includes(scope))
          error('Alcance inválido; usa Rango, Turno completo o Todo el día');
        if (scope === 'turno completo' || scope === 'todo el dia') {
          if (v.hora_inicio || v.hora_fin)
            error(
              'Deja Hora Inicio y Hora Fin vacías al elegir un alcance completo',
            );
          if (scope === 'todo el dia' && v.turno)
            error('Deja Turno vacío para Todo el día');
          const sessions = catalog.sessions.filter(
            (s) =>
              scope === 'todo el dia' ||
              (v.turno && plain(s.turno) === plain(v.turno)),
          );
          if (!sessions.length)
            error(
              'No hay horarios para el alcance y turno indicados en este proceso',
            );
          result.start_minute = sessions.length
            ? Math.min(...sessions.map((s) => minute(s.start)))
            : 0;
          result.end_minute = sessions.length
            ? Math.max(...sessions.map((s) => minute(s.end)))
            : 0;
          return result;
        }
        if (v.turno)
          error(
            'Para Rango deja Turno vacío; las horas son independientes del turno',
          );
        if (
          !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v.hora_inicio ?? '') ||
          !/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(v.hora_fin ?? '')
        )
          error('Horas inválidas; usa HH:mm');
        result.start_minute = minute(v.hora_inicio ?? '');
        result.end_minute = minute(v.hora_fin ?? '');
        if (result.start_minute >= result.end_minute)
          error('La hora de fin debe ser posterior a la inicial');
        if (
          kind === 'disponibilidad' &&
          !catalog.sessions.some(
            (s) =>
              minute(s.start) >= result.start_minute! &&
              minute(s.end) <= result.end_minute!,
          )
        )
          error('El rango no cubre ningún bloque completo del proceso');
        return result;
      }
      if (kind !== 'docentes') {
        const matches =
          classroomMap.get(`${plain(v.salon ?? '')}|${plain(v.turno ?? '')}`) ??
          [];
        if (matches.length !== 1)
          error(
            'Salón/turno inexistente o ambiguo; usa el catálogo de la plantilla',
          );
        const cls = matches.length === 1 ? matches[0] : undefined;
        result.class_id = cls?.id;
        result.monitor_id = cls?.monitor_id ?? undefined;
        result.shift_id = cls?.shift_id;
        if (kind !== 'desasignaciones' && !cls?.monitor_id)
          error('El salón no tiene monitor creado');
        if (kind === 'monitores') {
          result.user_id = cls?.user_id ?? undefined;
          const account = result.user_id ? usersById.get(result.user_id) : undefined;
          result.email = account?.email ?? '';
          if (!account?.is_active) error('La cuenta del monitor no existe o está inactiva');
          if (v.correo && plain(v.correo) !== plain(result.email))
            error('El correo del monitor es el creado con el salón y no se modifica mediante importación');
        }
        const duplicateKey = `${kind}|${cls?.id ?? `${v.salon}|${v.turno}`}|${kind === 'desasignaciones' ? result.email : ''}`;
        if (seen.has(duplicateKey))
          error(`Salón repetido (fila ${seen.get(duplicateKey)})`);
        seen.set(duplicateKey, row.line);
        if (kind === 'desasignaciones') return result;
      }
      const role =
        kind === 'docentes'
          ? 'profesor'
          : kind === 'monitores'
            ? 'monitor'
            : 'supervisor';
      if (kind === 'supervisores') result.user_id = existing?.id;
      if (
        kind === 'supervisores' &&
        existing?.supervisor_shift_id &&
        existing.supervisor_shift_id !== result.shift_id
      )
        error(
          'El supervisor pertenece a otro turno; no se cambia su turno mediante este lote',
        );
      if (kind === 'docentes' && existing)
        error(
          'El correo ya está registrado; este lote registra docentes nuevos',
        );
      if (
        existing &&
        (existing.role !== role ||
          (kind === 'monitores' && existing.id !== result.user_id))
      )
        error('El correo pertenece a otra cuenta');
      if (
        kind === 'monitores' &&
        result.user_id &&
        usersById.get(result.user_id)?.role !== 'monitor'
      )
        error('La cuenta del salón no corresponde a un monitor');
      result.dni = (v.dni ?? '').trim();
      result.first_name = (v.nombres ?? '').trim();
      result.last_name = (v.apellidos ?? '').trim();
      result.personal_email = plain(v.correo_personal ?? '');
      result.phone = (v.celular ?? '').trim();
      result.phones_additional = (v.celulares_adicionales ?? '')
        .split(/[,;\s]+/)
        .filter(Boolean);
      if (result.phones_additional.some((phone) => !/^9\d{8}$/.test(phone)))
        error(
          'Celulares adicionales inválidos; usa números de 9 dígitos separados por comas',
        );
      if (!/^\d{8}$/.test(result.dni))
        error(
          'El DNI debe contener 8 dígitos (formato texto para conservar ceros)',
        );
      if (
        !result.first_name ||
        !result.last_name ||
        result.first_name.length > 128 ||
        result.last_name.length > 128
      )
        error('Nombres y apellidos obligatorios, máximo 128 caracteres');
      if (result.personal_email && !emailValid(result.personal_email))
        error('Correo personal inválido');
      if (result.phone && !/^9\d{8}$/.test(result.phone))
        error('Celular inválido; usa 9 dígitos');
      const identity =
        kind === 'monitores' ? (result.user_id ?? result.email) : result.email;
      if (dnis.has(result.dni) && dnis.get(result.dni) !== result.user_id)
        error('El DNI pertenece a otra cuenta');
      if (
        result.personal_email &&
        personalEmails.has(result.personal_email) &&
        personalEmails.get(result.personal_email) !== result.user_id
      )
        error('El correo personal pertenece a otra cuenta');
      for (const [value, owners, label] of [
        [result.dni, dniOwners, 'DNI'],
        [result.personal_email, personalOwners, 'Correo personal'],
      ] as const) {
        if (value && owners.has(value) && owners.get(value) !== identity)
          error(`${label} repetido para otra persona del archivo`);
        if (value) owners.set(value, identity);
      }
      if (kind === 'docentes') {
        result.course_id = courses.get(plain(v.curso ?? ''));
        if (!result.course_id) error('Curso inexistente');
        result.job_status = (
          {
            'tiempo completo': 'FULL_TIME',
            fulltime: 'FULL_TIME',
            'medio tiempo': 'PART_TIME',
            parttime: 'PART_TIME',
            'tiempo libre': 'FREE_TIME',
            freetime: 'FREE_TIME',
          } as Record<string, string>
        )[plain(v.dedicacion ?? '')];
        if (!result.job_status) error('Dedicación inválida');
        result.max_hours = Number(v.horas_maximas);
        if (
          !Number.isInteger(result.max_hours) ||
          result.max_hours < 1 ||
          result.max_hours > 100
        )
          error('Horas máximas: entero entre 1 y 100');
      }
      const signature = JSON.stringify([
        result.dni,
        result.first_name,
        result.last_name,
        result.personal_email,
        result.phone,
        result.phones_additional,
        result.shift_id,
      ]);
      if (
        identities.has(result.email) &&
        (kind !== 'supervisores' || identities.get(result.email) !== signature)
      )
        error('Correo repetido o datos contradictorios en el archivo');
      identities.set(result.email, signature);
      return result;
    });
  }

  async preview(kind: ImportKind, buffer: Buffer, filename: string) {
    const raw = await readImport(buffer, filename, kind);
    const schema = this.schema();
    return this.drizzle.transaction(async (db) => {
      await db.query(`SET LOCAL search_path TO "${schema}"`);
      const rows = this.resolve(kind, raw, await this.catalog(db));
      if (kind === 'desasignaciones')
        await this.validateUnassignments(db, rows);
      return {
        schema,
        total: rows.length,
        valid: rows.filter((r) => !r.errors.length).length,
        rows: rows.map(({ line, values, errors }) => ({
          line,
          values,
          errors,
        })),
      };
    });
  }

  async apply(
    kind: ImportKind,
    buffer: Buffer,
    filename: string,
    expectedSchema: string,
  ) {
    const raw = await readImport(buffer, filename, kind);
    const schema = this.schema();
    if (schema !== expectedSchema)
      throw new ConflictException(
        'El proceso cambió; vuelve a validar el archivo',
      );
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.drizzle.transaction(async (db) => {
          await db.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
          await db.query(`SET LOCAL search_path TO "${schema}"`);
          await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `imports:${schema}`,
          ]);
          const rows = this.resolve(kind, raw, await this.catalog(db));
          if (kind === 'desasignaciones')
            await this.validateUnassignments(db, rows);
          const invalid = rows.filter((row) => row.errors.length);
          if (invalid.length)
            throw new BadRequestException({
              message:
                'El lote contiene errores; no se modificó ningún registro',
              rows: invalid.map(({ line, errors }) => ({ line, errors })),
            });
          if (kind === 'disponibilidad' || kind === 'retirar-disponibilidad')
            return this.availability(
              db,
              rows,
              kind === 'retirar-disponibilidad',
            );
          if (kind === 'desasignaciones') return this.unassign(db, rows);
          return this.people(db, rows, kind);
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if ((code === '40001' || code === '40P01') && attempt < 3) continue;
        if (code === '40001' || code === '40P01')
          throw new ConflictException(
            'Otro usuario cambió estos datos; vuelve a validar el archivo. No se aplicó el lote',
          );
        if (code === '23505')
          throw new ConflictException(
            'Una cuenta, DNI o correo ya está en uso; vuelve a validar. No se modificó el lote',
          );
        throw error;
      }
    }
  }

  private async validateUnassignments(db: PoolClient, rows: ResolvedRow[]) {
    const assignments = await db.query<{
      teacher_id: string;
      class_id: string;
    }>(
      `SELECT DISTINCT teacher_id,class_id FROM schedules WHERE teacher_id = ANY($1::uuid[]) AND class_id=ANY($2::uuid[])`,
      [
        [...new Set(rows.flatMap((r) => (r.teacher_id ? [r.teacher_id] : [])))],
        [...new Set(rows.flatMap((r) => (r.class_id ? [r.class_id] : [])))],
      ],
    );
    const assigned = new Set(
      assignments.rows.map((r) => `${r.teacher_id}|${r.class_id}`),
    );
    for (const row of rows)
      if (
        row.teacher_id &&
        row.class_id &&
        !assigned.has(`${row.teacher_id}|${row.class_id}`)
      )
        row.errors.push('El docente no tiene horas asignadas en ese salón');
  }

  private async availability(
    db: PoolClient,
    rows: ResolvedRow[],
    remove: boolean,
  ) {
    const ids = [...new Set(rows.map((row) => row.teacher_id!))];
    const current = await db.query<{
      teacher_id: string;
      weekday: string;
      start_minute: number;
      end_minute: number;
    }>(
      'SELECT teacher_id,weekday::text,start_minute,end_minute FROM teacher_availabilities WHERE teacher_id=ANY($1::uuid[])',
      [ids],
    );
    let intervals = current.rows.map((r) => ({
      teacherId: r.teacher_id,
      weekday: `${r.teacher_id}|${r.weekday}`,
      day: r.weekday,
      startMinute: r.start_minute,
      endMinute: r.end_minute,
    }));
    if (!remove)
      intervals.push(
        ...rows.map((r) => ({
          teacherId: r.teacher_id!,
          weekday: `${r.teacher_id}|${r.weekday}`,
          day: r.weekday!,
          startMinute: r.start_minute!,
          endMinute: r.end_minute!,
        })),
      );
    else {
      const ranges = new Map<string, { start: number; end: number }[]>();
      const removals = normalizeIntervals(
        rows.map((row) => ({
          weekday: `${row.teacher_id}|${row.weekday}`,
          startMinute: row.start_minute!,
          endMinute: row.end_minute!,
        })),
      );
      for (const row of removals) {
        const entries = ranges.get(row.weekday) ?? [];
        entries.push({ start: row.startMinute, end: row.endMinute });
        ranges.set(row.weekday, entries);
      }
      intervals = intervals.flatMap((item) => {
        let fragments = [item];
        for (const range of ranges.get(item.weekday) ?? [])
          fragments = fragments.flatMap((i) => {
            if (range.start >= i.endMinute || range.end <= i.startMinute)
              return [i];
            return [
              ...(i.startMinute < range.start
                ? [{ ...i, endMinute: range.start }]
                : []),
              ...(i.endMinute > range.end
                ? [{ ...i, startMinute: range.end }]
                : []),
            ];
          });
        return fragments;
      });
    }
    const normalized = normalizeIntervals(intervals).map((i) => ({
      teacher_id: i.teacherId,
      weekday: i.day,
      start_minute: i.startMinute,
      end_minute: i.endMinute,
    }));
    await db.query(
      'DELETE FROM teacher_availabilities WHERE teacher_id=ANY($1::uuid[])',
      [ids],
    );
    await db.query(
      `INSERT INTO teacher_availabilities(teacher_id,weekday,start_minute,end_minute) SELECT teacher_id,weekday::"Weekday",start_minute,end_minute FROM jsonb_to_recordset($1::jsonb) AS r(teacher_id uuid,weekday text,start_minute smallint,end_minute smallint)`,
      [JSON.stringify(normalized)],
    );
    return {
      processed: rows.length,
      teachers: ids.length,
      intervals: normalized.length,
    };
  }

  private async unassign(db: PoolClient, rows: ResolvedRow[]) {
    const result = await db.query<{ blocks: number }>(
      `WITH input AS (SELECT * FROM jsonb_to_recordset($1::jsonb) r(teacher_id uuid,class_id uuid)), removed AS (UPDATE schedules s SET teacher_id=NULL FROM input i WHERE s.teacher_id=i.teacher_id AND s.class_id=i.class_id RETURNING i.teacher_id), counts AS (SELECT teacher_id,count(*)::int AS total FROM removed GROUP BY teacher_id), updated AS (UPDATE teachers t SET scheduled_hours=GREATEST(0,t.scheduled_hours-c.total) FROM counts c WHERE t.id=c.teacher_id RETURNING t.id) SELECT count(*)::int AS blocks FROM removed`,
      [JSON.stringify(rows)],
    );
    return { processed: rows.length, blocks: result.rows[0].blocks };
  }

  private async people(
    db: PoolClient,
    rows: ResolvedRow[],
    kind: 'docentes' | 'monitores' | 'supervisores',
  ) {
    await db.query(
      `CREATE TEMP TABLE import_people ON COMMIT DROP AS SELECT COALESCE(user_id,uuidv7()) AS user_id,email,dni,first_name,last_name,NULLIF(phone,'') AS phone,phones_additional,NULLIF(personal_email,'') AS personal_email,class_id,monitor_id,shift_id,course_id,job_status,max_hours FROM jsonb_to_recordset($1::jsonb) r(user_id uuid,email text,dni text,first_name text,last_name text,phone text,phones_additional text[],personal_email text,class_id uuid,monitor_id uuid,shift_id smallint,course_id smallint,job_status text,max_hours smallint)`,
      [JSON.stringify(rows)],
    );
    // A supervisor may cover many classrooms. All rows share one generated/existing identity.
    if (kind === 'supervisores')
      await db.query(
        `UPDATE import_people i SET user_id=chosen.user_id FROM (SELECT DISTINCT ON(email) email,user_id FROM import_people ORDER BY email,user_id) chosen WHERE chosen.email=i.email`,
      );
    if (kind !== 'monitores')
      await db.query(
        `INSERT INTO users(id,email,role) SELECT DISTINCT ON(user_id) user_id,email,$1 FROM import_people ORDER BY user_id ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,is_active=true,updated_at=now()`,
        [kind === 'docentes' ? 'profesor' : 'supervisor'],
      );
    await db.query(
      `INSERT INTO user_profiles(user_id,dni,first_name,last_name,phone,personal_email,phones_additional) SELECT DISTINCT ON(user_id) user_id,dni,first_name,last_name,phone,personal_email,COALESCE(phones_additional,ARRAY[]::text[]) FROM import_people ORDER BY user_id ON CONFLICT(user_id) DO UPDATE SET dni=EXCLUDED.dni,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,phone=EXCLUDED.phone,personal_email=EXCLUDED.personal_email,phones_additional=EXCLUDED.phones_additional,is_active=true,updated_at=now()`,
    );
    if (kind === 'docentes')
      await db.query(
        `INSERT INTO teachers(user_id,course_id,job_status,max_hours) SELECT user_id,course_id,job_status::job_statuses,max_hours FROM import_people`,
      );
    if (kind === 'supervisores') {
      await db.query(
        `INSERT INTO supervisors(user_id,shift_id) SELECT DISTINCT ON(user_id) user_id,shift_id FROM import_people ORDER BY user_id ON CONFLICT(user_id) DO UPDATE SET shift_id=EXCLUDED.shift_id,updated_at=now()`,
      );
      await db.query(
        `UPDATE monitors m SET supervisor_id=s.id,updated_at=now() FROM import_people i JOIN supervisors s ON s.user_id=i.user_id WHERE m.id=i.monitor_id`,
      );
    }
    return {
      processed: rows.length,
      people: new Set(rows.map((r) => r.email)).size,
    };
  }

  async template(kind: ImportKind) {
    const schema = this.schema();
    return this.drizzle.transaction(async (db) => {
      await db.query(`SET LOCAL search_path TO "${schema}"`);
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Datos');
      sheet.columns = headers[kind].map((header) => ({
        header,
        key: header,
        width: header.includes('correo') ? 32 : 23,
      }));
      for (const column of sheet.columns) column.numFmt = '@';
      const example: Record<string, string> = {
        correo: 'persona@example.com',
        dni: '01234567',
        nombres: 'Nombre de ejemplo',
        apellidos: 'Apellido de ejemplo',
        correo_personal: '',
        celular: '987654321',
        curso: 'Física',
        dedicacion: 'Medio tiempo',
        horas_maximas: '20',
        salon: 'B-101',
        turno: 'Turno 01',
        dia: 'Lunes',
        alcance: 'Todo el día',
        hora_inicio: '',
        hora_fin: '',
      };
      if (kind.includes('disponibilidad')) example.turno = '';
      sheet.addRow(example);
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1C2140' },
      };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      const guide = workbook.addWorksheet('Guia');
      const notes = [
        `Proceso de referencia: ${schema}. Verifica el proceso seleccionado antes de importar.`,
        'Reemplaza la fila de ejemplo. Solo se lee la hoja Datos. XLSX, CSV y JSON; máximo 10000 filas y 8 MB. No se aceptan fórmulas.',
        'Consulta Cabeceras para ver nombres exactos, obligatoriedad, formato y ejemplos. En Datos, las cabeceras guinda requieren valor; las azules pueden quedar vacías. Conserva las cabeceras obligatorias aunque no rellenes sus valores opcionales.',
        'Cada cabecera de Datos tiene una nota con su formato. Copia la fila de ejemplo para conservar sus formatos y listas de selección al agregar filas. Solo llena Datos; las demás hojas son de consulta.',
        'Los DNI, correos, teléfonos y horas deben ser valores de texto. Conserva los ceros del DNI. Usa HH:mm en las horas (fin admite 24:00).',
        'Disponibilidad: docente existente por correo, día de Lunes a Domingo y rango de horas. Puedes repetir el docente en diferentes días o rangos. Los turnos comparten el tiempo. Solo son compatibles los bloques totalmente cubiertos.',
        'Registrar disponibilidad AGREGA y une rangos; no borra los existentes. Retirar disponibilidad recorta únicamente los rangos indicados. Ninguna de estas operaciones desasigna clases.',
        'Monitores: indica salón y turno del catálogo y completa únicamente los datos personales. El correo, la cuenta y el vínculo del monitor creados con el salón se conservan. No se importa un correo de acceso.',
        'Supervisores: registra o actualiza por correo y asigna al monitor del salón. Repite el supervisor para varios salones del mismo turno, con los mismos datos. No mueve otros monitores.',
        'Alcance: Rango exige Hora Inicio y Hora Fin; Turno completo exige Turno; Todo el día no requiere horas ni turno. Las opciones completas usan el horario del proceso, no horas fijas. 08:00–08:40 es solo ese intervalo, nunca todo un turno.',
        'Docentes: registra cuentas nuevas. Dedicación: Tiempo completo, Medio tiempo o Tiempo libre. Curso debe coincidir con el catálogo.',
        'Todo o nada: revisa los errores antes de confirmar. El servidor vuelve a validar al guardar. Si falla una fila no se aplica ninguna.',
      ];
      guide.columns = [{ header: 'Instrucciones', key: 'text', width: 120 }];
      notes.forEach((text) => {
        const row = guide.addRow({ text });
        row.alignment = { wrapText: true };
        row.height = 45;
      });
      const sessions = await db.query<{
        turno: string;
        bloque: number;
        inicio: string;
        fin: string;
      }>(
        `SELECT s.name AS turno,h.period AS bloque,to_char(h.start_time,'HH24:MI') AS inicio,to_char(h.end_time,'HH24:MI') AS fin FROM hour_sessions h JOIN shifts s ON s.id=h.shift_id ORDER BY s.id,h.period`,
      );
      const hours = workbook.addWorksheet('Horarios');
      hours.columns = ['turno', 'bloque', 'inicio', 'fin'].map((key) => ({
        header: {
          turno: 'Turno',
          bloque: 'Bloque',
          inicio: 'Hora Inicio',
          fin: 'Hora Fin',
        }[key]!,
        key,
        width: 24,
      }));
      hours.addRows(sessions.rows);
      if (sessions.rows[0] && !kind.includes('disponibilidad')) {
        if (headers[kind].includes('hora_inicio'))
          sheet.getRow(2).getCell('hora_inicio').value =
            sessions.rows[0].inicio;
        if (headers[kind].includes('hora_fin'))
          sheet.getRow(2).getCell('hora_fin').value = sessions.rows[0].fin;
      }
      const classes = await db.query<{ salon: string; turno: string }>(
        'SELECT c.name AS salon,s.name AS turno FROM classes c JOIN shifts s ON s.id=c.shift_id ORDER BY s.id,c.name',
      );
      const classrooms = workbook.addWorksheet('Salones');
      classrooms.columns = ['salon', 'turno'].map((key) => ({
        header: key === 'salon' ? 'Salón' : 'Turno',
        key,
        width: 35,
      }));
      classrooms.addRows(classes.rows);
      if (classes.rows[0]) {
        if (headers[kind].includes('salon'))
          sheet.getRow(2).getCell('salon').value = classes.rows[0].salon;
        if (headers[kind].includes('turno') && !kind.includes('disponibilidad'))
          sheet.getRow(2).getCell('turno').value = classes.rows[0].turno;
      }
      const courses = await db.query<{ curso: string }>(
        'SELECT name AS curso FROM courses ORDER BY name',
      );
      const courseSheet = workbook.addWorksheet('Cursos');
      courseSheet.columns = [{ header: 'Curso', key: 'curso', width: 35 }];
      courseSheet.addRows(courses.rows);
      if (courses.rows[0] && headers[kind].includes('curso'))
        sheet.getRow(2).getCell('curso').value = courses.rows[0].curso;
      formatTemplate(workbook, kind);
      return Buffer.from(await workbook.xlsx.writeBuffer());
    });
  }
}
