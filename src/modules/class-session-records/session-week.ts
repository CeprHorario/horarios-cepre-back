import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { SessionTx } from './session.types';

export function plusDays(date: string, amount: number): string {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
/** Sunday belongs to the week about to start; no arbitrary Sunday/date pair. */
export function operationalMonday(date: string): string {
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  return plusDays(date, weekday === 0 ? 1 : 1 - weekday);
}
export const weekDays = ['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'] as const;
export interface WeekPlan { week_start: Date; advanced_weekday: number|null; version: number; generated_at: Date|null }
export async function weekCutoff(tx: SessionTx, monday: string): Promise<Date> {
  const [row] = await tx.$queryRaw<{time:string|null}[]>`SELECT max(GREATEST(s.end_time,h.end_time))::text AS time FROM shifts s JOIN hour_sessions h ON h.shift_id=s.id`;
  if (!row?.time) throw new BadRequestException('Configura las horas de los turnos antes de planificar la semana');
  return new Date(`${plusDays(monday,-2)}T${row.time}-05:00`);
}
export async function findWeekPlan(tx: SessionTx, monday: string): Promise<WeekPlan|undefined> {
  const [row] = await tx.$queryRaw<WeekPlan[]>`SELECT week_start,advanced_weekday,version,generated_at FROM session_week_plans WHERE week_start=${new Date(monday)}::date`;
  return row;
}
/** Only changes execution mapping; the weekly schedule is never rewritten. */
export async function executionDateFor(tx: SessionTx, academic: string): Promise<string> {
  const day = new Date(academic + 'T12:00:00Z').getUTCDay();
  if (!day) return academic;
  const monday = plusDays(academic, 1-day);
  const plan = await findWeekPlan(tx, monday);
  return plan?.advanced_weekday === day ? plusDays(monday,-1) : academic;
}

export async function assertAdvanceNoConflicts(tx: SessionTx, academic: string, sunday: string) {
  const weekdayCode = ['','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][new Date(academic+'T12:00:00Z').getUTCDay()];
  const [collision] = await tx.$queryRaw<{id:number}[]>`SELECT a.id FROM schedules a
    JOIN hour_sessions ah ON ah.id=a.hour_session_id JOIN classes ac ON ac.id=a.class_id
    JOIN schedules b ON b.weekday='SUNDAY' JOIN hour_sessions bh ON bh.id=b.hour_session_id JOIN classes bc ON bc.id=b.class_id
    WHERE a.weekday::text=${weekdayCode}
      AND ah.start_time<bh.end_time AND ah.end_time>bh.start_time
      AND (a.class_id=b.class_id OR (a.teacher_id IS NOT NULL AND a.teacher_id=b.teacher_id) OR (ac.monitor_id IS NOT NULL AND ac.monitor_id=bc.monitor_id)) LIMIT 1`;
  if (collision) throw new BadRequestException('El adelanto se cruza con el horario del domingo de un salón, docente o monitor');
  const [recordCollision] = await tx.$queryRaw<{id:number}[]>`SELECT r.id FROM schedules s JOIN classes c ON c.id=s.class_id JOIN hour_sessions h ON h.id=s.hour_session_id
    JOIN class_session_records r ON r.date=${new Date(sunday)}::date AND r.deleted_at IS NULL
    WHERE s.weekday::text=${weekdayCode}
      AND COALESCE(r.academic_date,r.date)<>${new Date(academic)}::date
      AND r.scheduled_start<((${new Date(sunday)}::date+h.end_time) AT TIME ZONE 'America/Lima')
      AND r.scheduled_end>((${new Date(sunday)}::date+h.start_time) AT TIME ZONE 'America/Lima')
      AND (r.class_id=s.class_id OR (s.teacher_id IS NOT NULL AND (r.titular_teacher_id=s.teacher_id OR r.effective_teacher_id=s.teacher_id OR EXISTS(SELECT 1 FROM session_coverages cv WHERE cv.record_id=r.id AND cv.status='AUTHORIZED' AND cv.teacher_id=s.teacher_id))) OR (c.monitor_id IS NOT NULL AND (r.titular_monitor_id=c.monitor_id OR r.effective_monitor_id=c.monitor_id))) LIMIT 1`;
  if (recordCollision) throw new BadRequestException('El domingo ya tiene partes o reemplazos que se cruzan con esta jornada');
  const [requestCollision] = await tx.$queryRaw<{id:string}[]>`SELECT req.id FROM replacement_requests req JOIN schedules s ON s.weekday::text=${weekdayCode} JOIN hour_sessions h ON h.id=s.hour_session_id JOIN classes c ON c.id=s.class_id LEFT JOIN teachers t ON t.id=s.teacher_id LEFT JOIN monitors m ON m.id=c.monitor_id CROSS JOIN jsonb_array_elements(req.blocks) b WHERE req.status='APPROVED' AND req.date=${new Date(sunday)}::date AND (req.replacement_user_id=t.user_id OR req.replacement_user_id=m.user_id) AND (b->>'start')::timestamptz<((${new Date(sunday)}::date+h.end_time) AT TIME ZONE 'America/Lima') AND (b->>'end')::timestamptz>((${new Date(sunday)}::date+h.start_time) AT TIME ZONE 'America/Lima') LIMIT 1`;
  if (requestCollision) throw new BadRequestException('Un docente o monitor ya tiene un reemplazo autorizado en el domingo de destino');
}

/** Weekly duties and availability follow the selected academic day on the execution Sunday. */
export function availabilityWeekday(date: string) {
  const day = new Date(date+'T12:00:00Z').getUTCDay();
  const codes=['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  if(day!==0)return Prisma.sql`${codes[day]}`;
  return Prisma.sql`COALESCE((SELECT CASE advanced_weekday WHEN 1 THEN 'MONDAY' WHEN 2 THEN 'TUESDAY' WHEN 3 THEN 'WEDNESDAY' WHEN 4 THEN 'THURSDAY' WHEN 5 THEN 'FRIDAY' WHEN 6 THEN 'SATURDAY' END FROM session_week_plans WHERE week_start=${new Date(plusDays(date,1))}::date), 'SUNDAY')`;
}
