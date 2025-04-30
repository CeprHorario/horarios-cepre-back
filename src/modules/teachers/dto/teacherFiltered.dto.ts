import { ApiProperty } from '@nestjs/swagger';
import { Weekday } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, ValidateNested } from 'class-validator';

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
  @ApiProperty({ type: [HourSessionInput] })
  @ValidateNested({ each: true })
  hourSessions: HourSessionInput[];
}
