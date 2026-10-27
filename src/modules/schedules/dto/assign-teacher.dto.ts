import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

export class AssignTeacherDto {
  @IsUUID()
  teacherId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10000)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  classroomIds!: string[];
}
