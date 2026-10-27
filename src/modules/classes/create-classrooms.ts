import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '@database/prisma/prisma.service';
import type { ScheduleWeek } from '@database/prisma/data/type';
import { weekdayData } from '@database/prisma/data/type';
import type { CreateClassMonitorDto } from './dto/CreateClassData.dto';
import rawBio from '@database/prisma/data/schedules/bio.json';
import rawIng from '@database/prisma/data/schedules/ing.json';
import rawSoc from '@database/prisma/data/schedules/soc.json';
import rawExtra from '@database/prisma/data/schedules/extra.json';

const templates: Record<string, ScheduleWeek[]> = {
  Biomédicas: rawBio,
  Ingenierías: rawIng,
  Sociales: rawSoc,
  Extraordinario: rawExtra,
};

export async function createClassrooms(
  prisma: PrismaService,
  areaId: number,
  shiftId: number,
  quantity: number,
  customMonitor?: CreateClassMonitorDto,
) {
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 500 ||
    (quantity !== 1 && customMonitor)
  )
    throw new BadRequestException('Indica entre 1 y 500 salones por lote');
  const schema = prisma.getSchemaName();
  const table = (name: string) => Prisma.raw(`"${schema}"."${name}"`);
  try {
    return await prisma.getClient().$transaction(
      async (tx) => {
        const area = await tx.area.findUnique({ where: { id: areaId } });
        const shift = await tx.shift.findUnique({ where: { id: shiftId } });
        if (!area) throw new NotFoundException('Área no encontrada');
        if (!shift) throw new NotFoundException('Turno no encontrado');
        const patterns = templates[area.name];
        if (!patterns?.length)
          throw new BadRequestException(
            'El área no tiene plantilla de horario base',
          );
        const prefix = area.name[0].toUpperCase();
        // Serialize numbering across shifts with the same prefix, inside this process only.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${schema}),hashtext(${`classrooms:${prefix}`}))`;
        const existing = await tx.class.findMany({
          where: { areaId },
          select: { name: true, shiftId: true },
        });
        const suffix = `${prefix.toLowerCase()}@cepr.unsa.pe`;
        const accounts = await tx.user.findMany({
          where: { email: { endsWith: suffix, mode: 'insensitive' } },
          select: { email: true },
        });
        const courses = await tx.course.findMany({
          select: { id: true, name: true },
        });
        const sessions = await tx.hourSession.findMany({
          where: { shiftId },
          select: { id: true, period: true },
        });
        if (
          !(await tx.sede.findUnique({
            where: { id: 1 },
            select: { id: true },
          }))
        )
          throw new BadRequestException(
            'El proceso no tiene la sede base para crear salones',
          );
        const courseIds = new Map(
          courses.map((course) => [course.name, course.id]),
        );
        const sessionIds = new Map(
          sessions.map((session) => [session.period, session.id]),
        );
        const numbered = existing.map((room) => {
          const number = Number(room.name.match(/-(\d+)/)?.[1]) || 0;
          if (!Number.isSafeInteger(number))
            throw new BadRequestException(
              'La numeración de salones está fuera de rango',
            );
          return { ...room, number };
        });
        const usedNumbers = new Set(numbered.map((room) => room.number));
        const usedEmails = new Set(
          accounts.map((account) => account.email.toLowerCase()),
        );
        let next =
          numbered.reduce(
            (max, room) =>
              room.shiftId === shiftId ? Math.max(max, room.number) : max,
            shiftId * 100,
          ) + 1;
        const rooms: {
          ordinal: number;
          name: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          dni: string | null;
          phone: string | null;
          phones_additional: string[];
          personal_email: string | null;
        }[] = [];
        const scheduleRows: {
          ordinal: number;
          course_id: number;
          hour_session_id: number;
          weekday: string;
        }[] = [];
        const hasProfile = Boolean(
          customMonitor?.firstName && customMonitor.lastName,
        );
        for (let ordinal = 0; ordinal < quantity; ordinal++) {
          while (
            Number.isSafeInteger(next) &&
            (usedNumbers.has(next) || usedEmails.has(`${next}${suffix}`))
          )
            next++;
          if (!Number.isSafeInteger(next))
            throw new BadRequestException(
              'La numeración de salones está fuera de rango',
            );
          const number = next++;
          usedNumbers.add(number);
          const email =
            customMonitor?.email?.trim().toLowerCase() || `${number}${suffix}`;
          usedEmails.add(email);
          rooms.push({
            ordinal,
            name: `${prefix}-${number} ${area.name}`,
            email,
            first_name: hasProfile ? customMonitor!.firstName!.trim() : null,
            last_name: hasProfile ? customMonitor!.lastName!.trim() : null,
            dni: customMonitor?.dni || null,
            phone: customMonitor?.phone || null,
            phones_additional: customMonitor?.phonesAdditional ?? [],
            personal_email: customMonitor?.personalEmail || null,
          });
          const pattern =
            patterns[(number - shiftId * 100 - 1) % patterns.length];
          for (const day of pattern)
            for (const block of day.clases) {
              const course = courseIds.get(block.curso),
                session = sessionIds.get(block.bloque),
                weekday = weekdayData[day.dia];
              if (!course || !session || !weekday)
                throw new BadRequestException(
                  'Faltan cursos o sesiones del turno para generar todos los horarios base; no se creó ningún salón',
                );
              scheduleRows.push({
                ordinal,
                course_id: course,
                hour_session_id: session,
                weekday,
              });
            }
        }
        const inserted = await tx.$queryRaw<
          { id: string; ordinal: number }[]
        >(Prisma.sql`
        WITH input AS MATERIALIZED (
          SELECT uuidv7() AS user_id,uuidv7() AS monitor_id,uuidv7() AS class_id,r.* FROM jsonb_to_recordset(${JSON.stringify(rooms)}::jsonb)
            r(ordinal integer,name text,email text,first_name text,last_name text,dni text,phone text,phones_additional text[],personal_email text)
        ), users_inserted AS (
          INSERT INTO ${table('users')}(id,email,role) SELECT user_id,email,'monitor' FROM input RETURNING id
        ), profiles_inserted AS (
          INSERT INTO ${table('user_profiles')}(user_id,first_name,last_name,dni,phone,phones_additional,personal_email)
          SELECT i.user_id,i.first_name,i.last_name,i.dni,i.phone,i.phones_additional,i.personal_email FROM input i
            JOIN users_inserted u ON u.id=i.user_id WHERE i.first_name IS NOT NULL AND i.last_name IS NOT NULL RETURNING id
        ), monitors_inserted AS (
          INSERT INTO ${table('monitors')}(id,user_id) SELECT i.monitor_id,i.user_id FROM input i JOIN users_inserted u ON u.id=i.user_id RETURNING id
        ), classes_inserted AS (
          INSERT INTO ${table('classes')}(id,name,area_id,shift_id,id_sede,monitor_id)
          SELECT i.class_id,i.name,${areaId},${shiftId},1,i.monitor_id FROM input i JOIN monitors_inserted m ON m.id=i.monitor_id RETURNING id
        ) SELECT c.id,i.ordinal FROM classes_inserted c JOIN input i ON i.class_id=c.id ORDER BY i.ordinal
      `);
        const classIds = new Map(
          inserted.map((room) => [room.ordinal, room.id]),
        );
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO ${table('schedules')}(class_id,course_id,hour_session_id,weekday)
        SELECT class_id,course_id,hour_session_id,weekday::${table('Weekday')}
        FROM jsonb_to_recordset(${JSON.stringify(scheduleRows.map(({ ordinal, ...row }) => ({ ...row, class_id: classIds.get(ordinal) })))}::jsonb)
          r(class_id uuid,course_id smallint,hour_session_id smallint,weekday text)
      `);
        const classes = await tx.class.findMany({
          where: { id: { in: inserted.map((room) => room.id) } },
        });
        const byId = new Map(classes.map((room) => [room.id, room]));
        return {
          classes: inserted.map((room) => byId.get(room.id)!),
          scheduleBlocks: scheduleRows.length,
        };
      },
      { timeout: 30000, isolationLevel: 'ReadCommitted' },
    );
  } catch (error) {
    const dbError = error as {
      code?: string;
      meta?: {
        code?: string;
        driverAdapterError?: { cause?: { originalCode?: string } };
      };
    } | null;
    if (
      dbError?.code === 'P2002' ||
      (dbError?.code === 'P2010' &&
        (dbError.meta?.code === '23505' ||
          dbError.meta?.driverAdapterError?.cause?.originalCode === '23505'))
    ) {
      throw new ConflictException(
        'Hay un correo o dato de monitor ya registrado; no se creó ningún salón',
      );
    }
    throw error;
  }
}
