import {
  IsString,
  IsDate,
  IsNotEmpty,
  IsEnum,
  IsBoolean,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum Weekday {
  MONDAY = 'Lunes',
  TUESDAY = 'Martes',
  WEDNESDAY = 'Miercoles',
  THURSDAY = 'Jueves',
  FRIDAY = 'Viernes',
  SATURDAY = 'Sabado',
  SUNDAY = 'Domingo',
}

export class ScheduleDto {
  @ApiProperty({
    description: 'Día de la semana',
    enum: Weekday,
    example: Weekday.MONDAY,
  })
  @IsEnum(Weekday)
  weekday: Weekday;

  @ApiProperty({
    description: 'Hora de inicio del horario',
    example: '2025-03-25T08:00:00.000Z',
  })
  @IsDate()
  @Type(() => Date)
  startTime: Date;

  @ApiProperty({
    description: 'Hora de fin del horario',
    example: '2025-03-25T10:00:00.000Z',
  })
  @IsDate()
  @Type(() => Date)
  endTime: Date;

  @ApiProperty({
    description: 'Nombre del curso',
    example: 'Matemáticas',
  })
  @IsString()
  @IsNotEmpty()
  courseName: string;

  @ApiProperty({ description: 'Turno del bloque horario', example: 1 })
  @IsNumber()
  shiftId: number;

  @ApiProperty({ description: 'Si el bloque ya tiene docente asignado' })
  @IsBoolean()
  hasTeacher: boolean;
}
