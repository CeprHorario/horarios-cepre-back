import { Prisma } from '@prisma/client';
import { UUID } from 'crypto';

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

export type TodosLosHorarios = ScheduleWeek[];
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

export interface Monitor extends Prisma.MonitorCreateInput {
  id?: UUID;
}

export interface Class extends Prisma.ClassCreateInput {
  id?: UUID;
}

export interface AreaCourse {
  courseId: number;
  areaId: number;
  totalHours: number;
}
