import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  ValidateNested,
  IsArray,
  IsEnum,
  IsNumber,
  IsPositive,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Weekday } from '@prisma/client';

export class DayScheduleDto {
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  @ApiProperty({ example: 1 })
  bloque!: number;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ example: 'Historia' })
  curso!: string;

  @IsOptional()
  @IsEmail()
  @ApiProperty({ example: 'juan.perez@cepr.unsa.pe', required: false })
  docente?: string;
}

export class DayDto {
  @IsNotEmpty()
  @IsString()
  @IsEnum(Weekday)
  dia!: Weekday;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayScheduleDto)
  @ApiProperty({
    example: [
      {
        bloque: 1,
        curso: 'Historia',
        docente: 'juan.perez@cepr.unsa.pe',
      },
      {
        bloque: 2,
        curso: 'Filosofía',
        docente: 'maria.lopez@cepr.unsa.pe',
      },
    ],
  })
  clases!: DayScheduleDto[];
}

export class ScheduleWeekDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({ example: 'S-101' })
  salon!: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ example: 'Sociales' })
  area!: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ example: '1' })
  turno!: string;

  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({ example: 's101@cepr.unsa.pe' })
  monitor!: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ example: 'Sede Virtual' })
  sede!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayDto)
  @ApiProperty({
    example: [
      {
        dia: 'Lunes',
        clases: [
          {
            bloque: 1,
            curso: 'Historia',
            docente: 'juan.perez@cepr.unsa.pe',
          },
          {
            bloque: 3,
            curso: 'Filosofía',
            docente: 'maria.lopez@cepr.unsa.pe',
          },
        ],
      },
      {
        dia: 'Martes',
        clases: [
          {
            bloque: 1,
            curso: 'Cívica',
            docente: 'carlos.ramos@cepr.unsa.pe',
          },
          {
            bloque: 2,
            curso: 'Psicología',
            docente: 'lucia.salas@cepr.unsa.pe',
          },
        ],
      },
    ],
  })
  horarios!: DayDto[];
}
