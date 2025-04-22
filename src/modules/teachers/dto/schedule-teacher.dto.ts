import { ScheduleForTeacherDto } from '@modules/schedules/dto';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsUUID } from 'class-validator';

export class ScheduleTeacherDto {
  @IsUUID()
  classId: string;

  @IsString()
  @ApiProperty({ example: 'I-101 Ingenierías' })
  className: string;

  @IsString()
  @ApiProperty({ example: 'Matemática' })
  courseName: string;

  @IsString()
  @ApiProperty({ example: 'meet.google.com/abc-defg-hij' })
  urlMeet: string;

  @IsString()
  @ApiProperty({ example: 'classroom.google.com/abc-defg-hij' })
  urlClassroom: string;

  @IsString()
  @ApiProperty({ example: 'Turno 01' })
  shiftName: string;

  @Type(() => ScheduleForTeacherDto)
  schedules: ScheduleForTeacherDto[];
}
