import { availabilityWeekday } from '../class-session-records/session-week';
import { BadRequestException } from '@nestjs/common';
import { Prisma, type ClassSessionRecord } from '../../generated/prisma/client';
import type { SessionTx } from '../class-session-records/session.types';

interface Interval {
  start: string;
  end: string;
  startMinute: number;
  endMinute: number;
}
const weekdays = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

/** Shared by documentary requests and in-Part proposals. SQL aliases person/u are fixed, never user identifiers. */
export function teacherAvailabilitySql(
  date: string,
  blocks: Interval[],
  courseId: number | null,
  excludeRecords: number[] = [],
) {
  const json = JSON.stringify(blocks),
    weekday = weekdays[new Date(date).getUTCDay()];
  return Prisma.sql`AND person.course_id=${courseId}
    AND NOT EXISTS(SELECT 1 FROM schedules s JOIN hour_sessions h ON h.id=s.hour_session_id CROSS JOIN jsonb_array_elements(${json}::jsonb) b
      WHERE s.teacher_id=person.id AND s.weekday::text IN (${weekday},${availabilityWeekday(date)})
      AND (EXTRACT(HOUR FROM h.start_time)*60+EXTRACT(MINUTE FROM h.start_time))<(b->>'endMinute')::int
      AND (EXTRACT(HOUR FROM h.end_time)*60+EXTRACT(MINUTE FROM h.end_time))>(b->>'startMinute')::int)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${json}::jsonb) b WHERE NOT COALESCE((
      SELECT range_agg(int4range(a.start_minute,a.end_minute,'[)')) @> int4range((b->>'startMinute')::int,(b->>'endMinute')::int,'[)')
      FROM teacher_availabilities a WHERE a.teacher_id=person.id AND a.weekday::text=${availabilityWeekday(date)}),false))
    AND NOT EXISTS(SELECT 1 FROM session_coverages c JOIN class_session_records r ON r.id=c.record_id CROSS JOIN jsonb_array_elements(${json}::jsonb) b
      WHERE c.teacher_id=person.id AND c.status='AUTHORIZED' AND r.deleted_at IS NULL AND r.date=${new Date(date)}::date AND NOT(r.id=ANY(${excludeRecords}::int[]))
      AND r.scheduled_start<(b->>'end')::timestamptz AND r.scheduled_end>(b->>'start')::timestamptz)
    AND NOT EXISTS(SELECT 1 FROM class_session_records r CROSS JOIN jsonb_array_elements(${json}::jsonb) b
      WHERE r.effective_teacher_id=person.id AND r.deleted_at IS NULL AND r.date=${new Date(date)}::date AND NOT(r.id=ANY(${excludeRecords}::int[]))
      AND COALESCE(r.actual_start,r.scheduled_start)<(b->>'end')::timestamptz AND COALESCE(r.actual_end,r.scheduled_end)>(b->>'start')::timestamptz)
    AND NOT EXISTS(SELECT 1 FROM replacement_requests req CROSS JOIN jsonb_array_elements(req.blocks) rb CROSS JOIN jsonb_array_elements(${json}::jsonb) b
      WHERE req.status='APPROVED' AND req.replacement_user_id=u.id AND req.date=${new Date(date)}::date
      AND (rb->>'start')::timestamptz<(b->>'end')::timestamptz AND (rb->>'end')::timestamptz>(b->>'start')::timestamptz)`;
}

export async function assertPartTeacherAvailable(
  tx: SessionTx,
  record: ClassSessionRecord,
  teacherId: string,
) {
  await tx.$queryRaw`SELECT id FROM teachers WHERE id=${teacherId}::uuid FOR UPDATE`;
  const minutes = (instant: Date) => {
    const d = new Date(+instant - 5 * 3600000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  };
  const blocks = [
    {
      start: record.scheduledStart.toISOString(),
      end: record.scheduledEnd.toISOString(),
      startMinute: minutes(record.scheduledStart),
      endMinute: minutes(record.scheduledEnd),
    },
  ];
  const eligible = await tx.$queryRaw<
    { id: string }[]
  >`SELECT person.id FROM teachers person JOIN users u ON u.id=person.user_id
    WHERE person.id=${teacherId}::uuid AND u.is_active AND u.role='profesor'
    ${teacherAvailabilitySql(record.date.toISOString().slice(0, 10), blocks, record.courseId, [record.id])}`;
  if (!eligible.length)
    throw new BadRequestException(
      'El correo no corresponde a un docente activo del curso disponible en todo el bloque',
    );
}
