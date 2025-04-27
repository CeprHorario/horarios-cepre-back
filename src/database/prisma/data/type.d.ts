import { Prisma } from '@prisma/client';
import { UUID } from 'crypto';

export interface DataInitial {
  users: User[];
  areas: Area[];
  sedes: Sede[];
  shifts: Shift[];
}
export interface AreaHours {
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
