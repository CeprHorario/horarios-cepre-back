import { ScheduleForTeacherDto } from '@modules/schedules/dto';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsString, IsUUID } from 'class-validator';

export class ScheduleTeacherDto {
  @IsUUID()
  classId: string;

  @IsString()
  @ApiProperty({ example: 'I-101 Ingenierías' })
  className: string;

  @IsNumber()
  @ApiProperty({ example: 321 })
  courseId: number;

  @IsString()
  @ApiProperty({ example: 'Matemática' })
  courseName: string;

  @IsNumber()
  @ApiProperty({ example: 123 })
  areaId: number;

  @IsString()
  @ApiProperty({ example: 'Ingenierías' })
  areaName: string;

  @IsNumber()
  @ApiProperty({ example: 456 })
  shiftId: number;

  @IsString()
  @ApiProperty({ example: 'Turno 01' })
  shiftName: string;

  @Type(() => ScheduleForTeacherDto)
  schedules: ScheduleForTeacherDto[];
}
