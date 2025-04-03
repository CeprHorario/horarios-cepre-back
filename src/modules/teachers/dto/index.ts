import { PartialType, OmitType } from '@nestjs/swagger';
import { TeacherDto } from './teacher.dto';

// DTO idéntico al TeacherDto
export { TeacherDto };

// DTO base con propiedades comunes
export class TeacherBaseDto extends OmitType(TeacherDto, [
  'userId',
  'courseId',
] as const) {}

/* DTO para crear un profesor
export class CreateTeacherDto extends OmitType(TeacherDto, [
  'id',
  'user',
  'course',
  'updatedAt',
  'createdAt',
  'isCoordinator',
  'isActive',
] as const) {}
*/
// DTO para actualizar un profesor
export class UpdateTeacherDto extends PartialType(
  OmitType(TeacherDto, ['id', 'user', 'course'] as const),
) {}
