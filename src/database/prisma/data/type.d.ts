import { Prisma } from '@prisma/client';
import { UUID } from 'crypto';
import { Class } from '@prisma/client';

export interface DataInitial {
  users: User[];
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
  monitor: Monitor;
  classes: Class;
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

export interface User extends Prisma.UserCreateInput {
  id: UUID;
}

export interface Area extends Prisma.AreaCreateInput {
  id?: number;
}

export interface Sede extends Prisma.SedeCreateInput {
  id?: number;
}

export interface Shift extends Prisma.ShiftCreateInput {
  id: number;
}

export interface Course extends Prisma.CourseCreateInput {
  id?: number;
}

export interface Monitor {
  id?: UUID;
  userId: UUID;
}

export interface AreaCourse {
  courseId: number;
  areaId: number;
  totalHours: number;
}

export interface HourSessionData {
  id?: number;
  shiftId: number;
  period: number;
  startTime: string;
  endTime: string;
}

export interface ScheduleData {
  classId: string;
  courseId: number;
  hourSesionId: number;
  weekday: string;
}

export const weekdayData: Record<string, string> = {
  lunes: 'MONDAY',
  martes: 'TUESDAY',
  miercoles: 'WEDNESDAY',
  jueves: 'THURSDAY',
  viernes: 'FRIDAY',
  sabado: 'SATURDAY',
  domingo: 'SUNDAY',
};
