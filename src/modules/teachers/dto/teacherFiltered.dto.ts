import { ApiProperty } from '@nestjs/swagger';
import { Weekday } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber } from 'class-validator';

class SchedulesInput {
  @IsNumber()
  @ApiProperty({ example: 123 })
  hourSessionId: number;

  @IsEnum(Weekday)
  @ApiProperty({ enum: Weekday, example: Weekday.Lunes })
  weekday: Weekday;
}

export class TeacherFilteredDto {
  @IsNumber()
  @ApiProperty({ example: 321 })
  courseId: number;

  @Type(() => SchedulesInput)
  @ApiProperty({ type: [SchedulesInput] })
  schedules: SchedulesInput[];
}
