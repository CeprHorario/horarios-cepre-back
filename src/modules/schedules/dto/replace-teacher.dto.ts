import { IsInt, IsUUID, Min } from 'class-validator';

export class ReplaceTeacherDto {
  @IsUUID()
  classId!: string;

  @IsInt()
  @Min(1)
  courseId!: number;

  @IsUUID()
  expectedTeacherId!: string;

  @IsUUID()
  teacherId!: string;
}
