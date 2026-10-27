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
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { ConfigurationDto } from '@modules/admissions/dto/create-admission.dto';
import { Class } from '../../../generated/prisma/client';
import path from 'path';
import * as fs from 'fs';

/**
 * Validates the shift times to ensure that the end time is after the start time
 */
export const validateShiftTimes = (shift: ShiftStr, sessionMinutes = 40, breakMinutes = 5): Shift => {
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
    (endTime.getTime() - startTime.getTime()) / (1000 * 60) + breakMinutes;
  if (sessionMinutes < 1 || breakMinutes < 0 || diffMinutes % (sessionMinutes + breakMinutes) !== 0) {
    throw new Error(
      `Turno ${shift.name}: el rango debe contener sesiones completas de ${sessionMinutes} minutos y descansos de ${breakMinutes} minutos, sin descanso final`,
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
export const generateHourSessions = (shift: Shift, sessionMinutes = 40, breakMinutes = 5) => {
  const hourSessionData: HourSessionData[] = [];
  if (!Number.isInteger(sessionMinutes) || sessionMinutes < 1 || !Number.isInteger(breakMinutes) || breakMinutes < 0) throw new Error('Duraciones inválidas');
  const sessionDuration = sessionMinutes * 60 * 1000;
  const breakDuration = breakMinutes * 60 * 1000;

  const today = new Date().toISOString().split('T')[0];
  let current = new Date(`${today}T${shift.startTime}Z`);
  const endTime = new Date(`${today}T${shift.endTime}Z`);

  const formatTime6 = (date: Date): string => {
    return date.toISOString().split('T')[1].replace('Z', '').padEnd(15, '0');
  };

  for (let i = 1; current < endTime; i++) {
    const sessionEnd = new Date(current.getTime() + sessionDuration);
    if (sessionEnd > endTime) throw new Error('El turno termina antes de completar una sesión');
    hourSessionData.push({
      durationMinutes: sessionMinutes,
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
  const shiftNames = new Map(shifts.map((shift) => [shift.id, shift.name]));
  const areaNames = new Map(areas.map((area) => [area.id, area.name]));
  const result = classes.reduce<Record<string, Record<string, Class[]>>>(
    (acc, cls) => {
      const shiftName =
        shiftNames.get(cls.shiftId) ?? 'Unknown Shift';
      const areaName =
        areaNames.get(cls.areaId) ?? 'Unknown Area';

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
    // Generar correo
    const email = `${inicio + i}${letraArea}${domain}`;
    const className = `${area[0].toUpperCase()}-${inicio + i} ${area}`;

    return {
      user: {
        email,
        role: Role.MONITOR,
      },
      classes: {
        name: className,
        capacity: 100,
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
  const sessionIds = new Map(hourSessions.map((hour) => [`${hour.shiftId}|${hour.period}`, hour.id]));
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
            sessionIds.get(`${c.shiftId}|${cl.bloque}`) ?? 0;
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
