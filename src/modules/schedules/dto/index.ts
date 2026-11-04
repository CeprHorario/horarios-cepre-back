import { PartialType, OmitType } from '@nestjs/swagger';
import { ScheduleDto } from './schedule.dto';
import { ScheduleForTeacherDto } from './scheduleForTeacher.dto';
import { ScheduleWeekDto } from './schedule-week.dto';

// DTO idéntico al ScheduleDto
export { ScheduleDto, ScheduleWeekDto };

// DTO base con propiedades comunes
export class ScheduleBaseDto extends OmitType(ScheduleDto, [
  'classId',
  'courseId',
  'hourSessionId',
  'teacherId',
]) {}

// DTO para crear un área
export class CreateScheduleDto extends OmitType(ScheduleDto, [
  'id',
  'clas',
  'course',
  'hourSession',
  'teacher',
] as const) {}

// DTO para actualizar un área
export class UpdateScheduleDto extends PartialType(
  OmitType(ScheduleDto, [
    'id',
    'clas',
    'course',
    'hourSession',
    'teacher',
  ] as const),
) {}

export class ScheduleForClass extends OmitType(ScheduleDto, [
  'clas',
  'courseId',
  'course',
  'teacher',
] as const) {
  name: string;
}
export { ScheduleForTeacherDto };
