import { BadRequestException } from '@nestjs/common';
import { assertSchemaName } from '@database/schema-manager/schema-name';
import { Prisma, type Weekday } from '../../generated/prisma/client';
import type { TimeInterval } from './availability';

export const DATABASE_WEEKDAY: Record<Weekday, string> = {
  Lunes: 'MONDAY',
  Martes: 'TUESDAY',
  Miercoles: 'WEDNESDAY',
  Jueves: 'THURSDAY',
  Viernes: 'FRIDAY',
  Sabado: 'SATURDAY',
  Domingo: 'SUNDAY',
};

export function pagination(page: number, size: number) {
  const current = Number(page),
    limit = Number(size);
  if (
    !Number.isSafeInteger(current) ||
    current < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    !Number.isSafeInteger((current - 1) * limit)
  ) {
    throw new BadRequestException(
      'Página positiva y tamaño entre 1 y 500 requeridos',
    );
  }
  return { limit, offset: (current - 1) * limit };
}

function tables(schema: string) {
  assertSchemaName(schema);
  // Identifiers come only from this module; schema is validated, values remain parameters.
  return (table: string) => Prisma.raw(`"${schema}"."${table}"`);
}

export function compatibleClassroomsSql(
  schema: string,
  options: {
    courseId: number;
    teacherId: string;
    slots: { id_hour_session: number; weekday: Weekday }[];
    page: number;
    size: number;
    areaId?: number;
    shiftId?: number;
  },
) {
  const table = tables(schema);
  const { limit, offset } = pagination(options.page, options.size);
  if (
    !Array.isArray(options.slots) ||
    options.slots.length > 10000 ||
    options.slots.some(
      (slot) =>
        !slot ||
        !Number.isInteger(slot.id_hour_session) ||
        slot.id_hour_session < 1 ||
        !Object.hasOwn(DATABASE_WEEKDAY, slot.weekday),
    )
  ) {
    throw new BadRequestException('Bloques de horario inválidos');
  }
  const slots = JSON.stringify(
    options.slots.map((slot) => ({
      id: slot.id_hour_session,
      weekday: DATABASE_WEEKDAY[slot.weekday],
    })),
  );
  return Prisma.sql`
    WITH requested AS (
      SELECT * FROM jsonb_to_recordset(${slots}::jsonb) AS r(id integer,weekday text)
    ), availability AS (
      SELECT weekday,range_agg(int4range(start_minute,end_minute,'[)')) AS ranges
      FROM ${table('teacher_availabilities')} WHERE teacher_id=${options.teacherId}::uuid GROUP BY weekday
    )
    SELECT c.id FROM ${table('classes')} c
    WHERE (${options.areaId ?? null}::integer IS NULL OR c.area_id=${options.areaId ?? null}::integer)
      AND (${options.shiftId ?? null}::integer IS NULL OR c.shift_id=${options.shiftId ?? null}::integer)
      AND EXISTS (SELECT 1 FROM ${table('schedules')} s WHERE s.class_id=c.id AND s.course_id=${options.courseId})
      AND NOT EXISTS (
        SELECT 1 FROM ${table('schedules')} s
        JOIN ${table('hour_sessions')} h ON h.id=s.hour_session_id
        LEFT JOIN availability a ON a.weekday=s.weekday
        WHERE s.class_id=c.id AND s.course_id=${options.courseId} AND (
          s.teacher_id IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM requested r WHERE r.id=s.hour_session_id AND r.weekday=s.weekday::text)
          OR a.ranges IS NULL
          OR NOT (a.ranges @> int4range(floor(extract(epoch FROM h.start_time)/60)::int,floor(extract(epoch FROM h.end_time)/60)::int,'[)'))
          OR EXISTS (
            SELECT 1 FROM ${table('schedules')} occupied
            JOIN ${table('hour_sessions')} busy ON busy.id=occupied.hour_session_id
            WHERE occupied.teacher_id=${options.teacherId}::uuid AND occupied.weekday=s.weekday
              AND busy.start_time<h.end_time AND h.start_time<busy.end_time
          )
        )
      )
    ORDER BY c.name,c.id LIMIT ${limit} OFFSET ${offset}
  `;
}

export function compatibleTeachersSql(
  schema: string,
  options: {
    courseId: number;
    intervals: TimeInterval[];
    page: number;
    size: number;
  },
) {
  const table = tables(schema);
  const { limit, offset } = pagination(options.page, options.size);
  const intervals = JSON.stringify(
    options.intervals.map((interval) => ({
      weekday: DATABASE_WEEKDAY[interval.weekday as Weekday],
      start_minute: interval.startMinute,
      end_minute: interval.endMinute,
    })),
  );
  return Prisma.sql`
    WITH requested AS (
      SELECT * FROM jsonb_to_recordset(${intervals}::jsonb) AS r(weekday text,start_minute integer,end_minute integer)
    ), eligible AS (
      SELECT t.id FROM ${table('teachers')} t JOIN ${table('users')} u ON u.id=t.user_id
      WHERE u.is_active AND t.course_id=${options.courseId} AND t.max_hours-t.scheduled_hours>=${options.intervals.length}
    ), availability AS (
      SELECT a.teacher_id,a.weekday,range_agg(int4range(a.start_minute,a.end_minute,'[)')) AS ranges
      FROM ${table('teacher_availabilities')} a JOIN eligible e ON e.id=a.teacher_id GROUP BY a.teacher_id,a.weekday
    )
    SELECT e.id FROM eligible e WHERE NOT EXISTS (
      SELECT 1 FROM requested r LEFT JOIN availability a ON a.teacher_id=e.id AND a.weekday::text=r.weekday
      WHERE a.ranges IS NULL OR NOT (a.ranges @> int4range(r.start_minute,r.end_minute,'[)')) OR EXISTS (
        SELECT 1 FROM ${table('schedules')} occupied
        JOIN ${table('hour_sessions')} h ON h.id=occupied.hour_session_id
        WHERE occupied.teacher_id=e.id AND occupied.weekday::text=r.weekday
          AND floor(extract(epoch FROM h.start_time)/60)<r.end_minute
          AND r.start_minute<floor(extract(epoch FROM h.end_time)/60)
      )
    ) ORDER BY e.id LIMIT ${limit} OFFSET ${offset}
  `;
}
