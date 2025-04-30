import { ApiProperty } from '@nestjs/swagger';
import { Weekday } from '@prisma/client';
import { IsDate, IsEnum, IsNumber, IsString } from 'class-validator';

export class ScheduleForClass {
  @IsNumber()
  @ApiProperty({
    example: '123',
  })
  id: number;

  @IsEnum(Weekday)
  @ApiProperty({
    example: Weekday.Lunes,
  })
  weekDay: Weekday;

  @IsDate()
  startTime: Date;

  @IsDate()
  endTime: Date;

  @IsString()
  @ApiProperty({
    example: 'Biología',
  })
  courseName: string;
}
