import { Role } from '@modules/auth/decorators/authorization.decorator';

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

export interface User {
  email: string;
  role: Role;
}

export interface Area {
  name: string;
  description: string;
}

export interface Sede {
  name: string;
  description: string;
}

export interface Shift {
  name: string;
}

export interface Course {
  name: string;
  color: string;
  description: string;
}
