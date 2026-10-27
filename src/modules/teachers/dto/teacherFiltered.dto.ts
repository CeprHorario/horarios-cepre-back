import { ApiProperty } from '@nestjs/swagger';
import { Weekday } from '../../../generated/prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNumber,
  ValidateNested,
} from 'class-validator';

class HourSessionInput {
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

  @Type(() => HourSessionInput)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10000)
  @ApiProperty({ type: [HourSessionInput] })
  @ValidateNested({ each: true })
  hourSessions: HourSessionInput[];
}
