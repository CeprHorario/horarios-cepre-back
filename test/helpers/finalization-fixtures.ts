import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';
import extraTemplate from '../../src/database/prisma/data/schedules/extra.json';

/** Variantes de coordinación exclusivamente en el harness opt-in de finalización. */
export async function seedFinalizationFixtures(clients: PrismaClient[]) {
  const principal = { userId: randomUUID(), email: 'course-coordinator@test.invalid', role: 'coordinador-1' };
  const outsideTeacherId = randomUUID();
  const outsideUserId = randomUUID();
  const outsideClassId = randomUUID();
  for (const db of clients) {
    // Catálogo real de plantilla, con IDs separados de los snapshots de Partes.
    // Permite altas de aulas/monitores sin inventar una plantilla ni renombrar Area1.
    await db.area.create({ data: { id: 2, name: 'Extraordinario' } });
    await db.shift.create({ data: { id: 2, name: 'Turno sintético Extraordinario', startTime: new Date('1970-01-01T07:00:00Z'), endTime: new Date('1970-01-01T11:25:00Z') } });
    const names = [...new Set(extraTemplate.flatMap(week => week.flatMap(day => day.clases.map(block => block.curso))))];
    for (const [index, name] of names.entries()) await db.course.create({ data: { id: 100 + index, name } });
    for (let period = 1; period <= 6; period++) {
      const minute = 7 * 60 + (period - 1) * 45;
      const at = (value: number) => new Date(Date.UTC(1970, 0, 1, Math.floor(value / 60), value % 60));
      await db.hourSession.create({ data: { id: 2000 + period, shiftId: 2, period, startTime: at(minute), endTime: at(minute + 40) } });
    }
    await db.user.create({ data: {
      id: principal.userId, email: principal.email, role: principal.role,
      userProfile: { create: { firstName: 'Coordinación', lastName: 'Curso uno', phonesAdditional: [] } },
    } });
    await db.course.create({ data: { id: 2, name: 'Curso fuera de alcance', color: '#25608f' } });
    await db.user.create({ data: {
      id: outsideUserId, email: 'outside-course@test.invalid', role: 'profesor',
      userProfile: { create: { firstName: 'Docente', lastName: 'Otro curso', phonesAdditional: [] } },
      teacher: { create: { id: outsideTeacherId, courseId: 2, maxHours: 20, scheduledHours: 1, jobStatus: 'PartTime' } },
    } });
    await db.class.create({ data: { id: outsideClassId, name: 'Aula de otro curso', areaId: 1, idSede: 1, shiftId: 1 } });
    await db.schedule.create({ data: { classId: outsideClassId, courseId: 2, teacherId: outsideTeacherId, hourSessionId: 1, weekday: 'Martes' } });
    await db.$executeRaw`SELECT setval(pg_get_serial_sequence(current_schema()||'.courses','id'),(SELECT max(id) FROM courses),true)`;
    await db.$executeRaw`SELECT setval(pg_get_serial_sequence(current_schema()||'.areas','id'),(SELECT max(id) FROM areas),true)`;
    await db.$executeRaw`SELECT setval(pg_get_serial_sequence(current_schema()||'.shifts','id'),(SELECT max(id) FROM shifts),true)`;
    await db.$executeRaw`SELECT setval(pg_get_serial_sequence(current_schema()||'.hour_sessions','id'),(SELECT max(id) FROM hour_sessions),true)`;
  }
  return { principal, outsideTeacherId, outsideClassId };
}
