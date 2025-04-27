import { BadRequestException } from '@nestjs/common';
import { DataMonitor, InDataMonitors, Shift, ShiftStr } from './type';
import { randomUUID, UUID } from 'crypto';

/**
 * Validates the shift times to ensure that the end time is after the start time
 */
export const validateShiftTimes = (shift: ShiftStr): Shift => {
  const id = numberShift(shift.name);
  const today = new Date().toISOString().split('T')[0];
  const startTime = new Date(`${today}T${shift.startTime}:00Z`);
  const endTime = new Date(`${today}T${shift.endTime}:00Z`);

  if (endTime <= startTime) {
    throw new BadRequestException(
      `Shift: end time must be after start time in ${shift.name}`,
    );
  }

  const diffMinutes =
    (endTime.getTime() - startTime.getTime() + 300000) / (1000 * 60);
  if (diffMinutes % 45 !== 0) {
    throw new BadRequestException(
      `Shift: invalid time difference in ${shift.name}`,
    );
  }

  return {
    id,
    name: shift.name,
    startTime,
    endTime,
  };
};

/**
 * Generates email addresses based on the provided data.
 */
export const generarCorreos = (data: InDataMonitors): DataMonitor[] => {
  // Extract the first letter of the area and the number from the shift
  const { domain, area, areas, shift, shifts, sedes, quantity } = data;

  const letraArea = area.trim()[0].toLowerCase();
  const turnoNumero = numberShift(shift); // Extrae números del turno
  const base = turnoNumero === 1 ? 100 : turnoNumero === 2 ? 200 : 300;
  const inicio = base + 1;

  const correos = Array.from({ length: quantity }, (_, i) => {
    return `${letraArea}-${inicio + i}@${domain}`;
  });

  return correos;
};

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
