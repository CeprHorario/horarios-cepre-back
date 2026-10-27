import { Prisma, Class } from '../../../generated/prisma/client';

export interface DataInitial {
  areas: Area[];
  sedes: Sede[];
  shifts: Shift[];
}

export type InDataMonitors = {
  domain: string;
  area: string;
  shift: string;
  areas: Area[];
  shifts: Shift[];
  sedes: Sede[];
  quantity: number;
};

export interface DataMonitor {
  user: User;
  classes: Omit<Class, 'id' | 'monitorId'>;
}

export interface AreaCourseHours {
  area: string;
  hours: CourseHour[];
}

export type ScheduleWeek = ScheduleDay[];

export interface Bloque {
  bloque: number;
  curso: string;
}

export interface ScheduleDay {
  dia: string;
  clases: Bloque[];
}

export interface CourseHour {
  course: string;
  total: string;
}

export interface ShiftStr {
  id?: number;
  name: string;
  startTime: string;
  endTime: string;
}

export type User = Prisma.UserCreateInput;

export interface Area extends Prisma.AreaCreateInput {
  id?: number;
}

export interface Sede extends Prisma.SedeCreateInput {
  id?: number;
}

export interface Shift {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
}

export interface Course extends Prisma.CourseCreateInput {
  id?: number;
}

export interface AreaCourse {
  courseId: number;
  areaId: number;
  totalHours: number;
}

export interface HourSessionData {
  durationMinutes?: number;
  id?: number;
  shiftId: number;
  period: number;
  startTime: string;
  endTime: string;
}

export interface ScheduleData {
  classId: string;
  courseId: number;
  hourSessionId: number;
  weekday: string;
}

export const weekdayData: Record<string, string> = {
  Lunes: 'MONDAY',
  Martes: 'TUESDAY',
  Miercoles: 'WEDNESDAY',
  Jueves: 'THURSDAY',
  Viernes: 'FRIDAY',
  Sabado: 'SATURDAY',
  Domingo: 'SUNDAY',
};
