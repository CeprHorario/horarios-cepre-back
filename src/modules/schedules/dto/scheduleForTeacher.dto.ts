import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Weekday } from '../../../generated/prisma/client';
import { ApiProperty } from '@nestjs/swagger';

import { HourSessionForTeacherDto } from '@modules/hour-session/dto/HourSessionForTeacher.dto';
import { Expose } from 'class-transformer';

export class ScheduleForTeacherDto {
  @Expose()
  @IsOptional()
  hourSession: HourSessionForTeacherDto;

  @Expose()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsEnum(Weekday)
  @ApiProperty({ example: 'Lunes' })
  weekday!: Weekday;
}
