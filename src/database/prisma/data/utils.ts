import {
  Area,
  DataMonitor,
  HourSessionData,
  InDataMonitors,
  Sede,
  Shift,
  ShiftStr,
  ScheduleWeek,
  ScheduleData,
  weekdayData,
} from './type';
import { randomUUID, UUID } from 'crypto';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { ConfigurationDto } from '@modules/admissions/dto/create-admission.dto';
import { Class } from '@prisma/client';
import path from 'path';
import * as fs from 'fs';

/**
 * Validates the shift times to ensure that the end time is after the start time
 */
export const validateShiftTimes = (shift: ShiftStr): Shift => {
  const id = numberShift(shift.name);
  const today = new Date().toISOString().split('T')[0];
  const startTime = new Date(`${today}T${shift.startTime}:00Z`);
  const endTime = new Date(`${today}T${shift.endTime}:00Z`);

  if (endTime <= startTime) {
    throw new Error(
      `Shift: end time must be after start time in ${shift.name}`,
    );
  }

  const diffMinutes =
    (endTime.getTime() - startTime.getTime() + 300000) / (1000 * 60);
  if (diffMinutes % 45 !== 0) {
    throw new Error(
      `Shift: invalid time difference of 45 minutes in ${shift.name}`,
    );
  }

  return {
    id,
    name: shift.name,
    startTime: `${shift.startTime}:00`,
    endTime: `${shift.endTime}:00`,
  };
};

/**
 * Generates hour sessions based on the provided shift data.
 */
export const generateHourSessions = (shift: Shift) => {
  const hourSessionData: HourSessionData[] = [];
  const sessionDuration = 40 * 60 * 1000; // 40 minutes in milliseconds
  const breakDuration = 5 * 60 * 1000; // 5 minutes in milliseconds

  const today = new Date().toISOString().split('T')[0];
  let current = new Date(`${today}T${shift.startTime}Z`);
  const endTime = new Date(`${today}T${shift.endTime}Z`);

  const formatTime6 = (date: Date): string => {
    return date.toISOString().split('T')[1].replace('Z', '').padEnd(15, '0');
  };

  for (let i = 1; current < endTime; i++) {
    const sessionEnd = new Date(current.getTime() + sessionDuration);
    hourSessionData.push({
      shiftId: shift.id,
      period: i,
      startTime: formatTime6(current), // only time with precision
      endTime: formatTime6(sessionEnd),
    });
    current = new Date(sessionEnd.getTime() + breakDuration);
  }

  return hourSessionData;
};

/**
 * Groups classes by shift and area, and sorts them randomly.
 */ // turno, area y clases
export const getMapAndSorted = (
  classes: Class[],
  shifts: Shift[],
  areas: Area[],
): Record<string, Record<string, Class[]>> => {
  const result = classes.reduce<Record<string, Record<string, Class[]>>>(
    (acc, cls) => {
      const shiftName =
        shifts.find((s) => s.id === cls.shiftId)?.name ?? 'Unknown Shift';
      const areaName =
        areas.find((a) => a.id === cls.areaId)?.name ?? 'Unknown Area';

      if (!acc[areaName]) acc[areaName] = {};
      if (!acc[areaName][shiftName]) acc[areaName][shiftName] = [];
      acc[areaName][shiftName].push(cls);

      return acc;
    },
    {},
  );

  // Ordenar por nombre de clase (alfabéticamente)
  Object.values(result).forEach((shift) => {
    Object.values(shift).forEach((classList) => {
      classList.sort((a, b) => a.name.localeCompare(b.name));
    });
  });

  return result;
};

/**
 * Generates email addresses based on the provided data.
 */
export const generarDataMonitors = (data: InDataMonitors): DataMonitor[] => {
  const { domain, area, areas, shift, shifts, sedes, quantity } = data;

  // Obtener los IDs necesarios
  const areaId = areas.find((a) => a.name === area)?.id;
  const shiftId = shifts.find((s) => s.name === shift)?.id;
  const sedeId = sedes[0]?.id;

  // Extraer la primera letra del área y el número del turno para generar correos
  const letraArea = area.trim()[0].toLowerCase();
  const turnoNum = numberShift(shift);
  const inicio = turnoNum * 100 + 1;

  // Generar los datos para cada monitor
  return Array.from({ length: quantity }, (_, i) => {
    // Generar IDs
    const userId = randomUUID();
    const monitorId = randomUUID();
    const classId = randomUUID();
    // Generar correo
    const email = `${inicio + i}${letraArea}${domain}`;
    const className = `${area[0].toUpperCase()}-${inicio + i} ${area}`;

    return {
      user: {
        id: userId,
        email,
        role: Role.MONITOR,
      },
      monitor: {
        id: monitorId,
        userId,
      },
      classes: {
        id: classId,
        name: className,
        capacity: 100,
        monitorId: monitorId,
        shiftId: shiftId ?? 0,
        areaId: areaId ?? 0,
        idSede: sedeId ?? 0,
        urlClassroom: null,
        urlMeet: null,
      },
    };
  });
};

/**
 * Generate data users, monitors and classes
 */
export const arrayMonitors = (
  config: ConfigurationDto,
  areas: Area[],
  shifts: Shift[],
  sedes: Sede[],
) => {
  const domain = config.emailDomain;
  const dataMonitors: DataMonitor[] = [];

  config.shifts.forEach((shift) => {
    shift.classesToAreas.forEach((area) => {
      const data = generarDataMonitors({
        domain,
        area: area.area,
        shift: shift.name,
        areas,
        shifts,
        sedes,
        quantity: area.quantityClasses,
      });
      dataMonitors.push(...data);
    });
  });

  return dataMonitors;
};

/**
 * Extracts the numeric part from a shift string.

 */
const numberShift = (shift: string): number => {
  return parseInt(shift.replace(/\D/g, ''), 10);
};

/**
 * Assigns numeric IDs to an array of objects.
 */
export const assignNumericIds = <T extends { id?: number }>(
  items: T[],
): T[] => {
  return items.map((item, index) => ({
    ...item,
    id: index + 1,
  }));
};

/**
 * Assigns UUIDs to an array of objects.
 */
export const assignUuidIds = <T extends { id?: UUID }>(items: T[]): T[] => {
  return items.map((item) => ({
    ...item,
    id: randomUUID(),
  }));
};

/**
 * Assigns either numeric or UUID IDs to an array of objects based on the existing ID type.
 * If the ID is a number, it assigns a sequential number starting from 1.
 * If the ID is a string, it assigns a random UUID.
 */
export function assignIds<T extends { id?: number | string }>(items: T[]): T[] {
  return items.map((item, index) => ({
    ...item,
    id: typeof item.id === 'number' ? index + 1 : randomUUID(),
  }));
}

/**
 *  Parsed Schedule JSON
 */
export const parseScheduleJson = (filePath: string): ScheduleWeek[] => {
  const bioJsonPath = path.resolve(__dirname, filePath);

  const bioJsonContent = fs.readFileSync(bioJsonPath, 'utf-8');
  return JSON.parse(bioJsonContent) as ScheduleWeek[];
};

/**
 * Generates schedule data based on the provided schedules, classes, course map, and hour sessions.
 */
export const generateScheduleData = (
  dataSchedules: ScheduleWeek[],
  classes: Record<string, Class[]>,
  courseMap: Map<string, number>,
  hourSessions: HourSessionData[],
) => {
  let index = 0;
  let currentAreaId: number | null = null;

  const scheduleData: ScheduleData[] = [];
  Object.values(classes).flatMap((classGroup) =>
    classGroup.flatMap((c) => {
      // Reiniciar el índice cuando cambia el areaId
      if (currentAreaId !== null && currentAreaId !== c.shiftId) {
        index = 0;
      }
      currentAreaId = c.shiftId;

      dataSchedules[index].flatMap((d) => {
        d.clases.map((cl) => {
          const hourSessionId =
            hourSessions.find(
              (h) => h.shiftId === c.shiftId && h.period === cl.bloque,
            )?.id ?? 0;
          scheduleData.push({
            courseId: courseMap.get(cl.curso) ?? 0,
            hourSessionId,
            classId: c.id,
            weekday: weekdayData[d.dia],
          });

          if (hourSessionId === 0) {
            throw new Error(
              `Error: No se encontró la sesión horaria para el bloque ${cl.bloque} y el turno ${c.shiftId} En el salon ${c.name} del curso ${cl.curso}`,
            );
          }
        });
      });

      index = index === dataSchedules.length - 1 ? 0 : index + 1;
    }),
  );
  return scheduleData;
};

/**
 * Validate schedules json
 */
export function parsedScheduleJson(data: any): ScheduleWeek[] {
  // Aquí podrías agregar validaciones adicionales si lo necesitas
  return data as ScheduleWeek[];
}
