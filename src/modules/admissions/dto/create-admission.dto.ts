import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  IsBoolean,
  Matches,
  ValidateNested,
  IsArray,
  ArrayNotEmpty,
  IsIn,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';

import * as rawData from '@database/prisma/data/initial.json';
import { DataInitial } from '@database/prisma/data/type';
import { ApiProperty } from '@nestjs/swagger';

const dataInitial = rawData as DataInitial;
const validAreas: string[] = dataInitial.areas.map((area) => area.name);
const validSedes: string[] = dataInitial.sedes.map((sede) => sede.name);
const validShifts: string[] = dataInitial.shifts.map((shift) => shift.name);

export class ClassToAreaDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(validAreas)
  @ApiProperty({ example: validAreas[0] })
  area: string;

  @IsInt()
  @Min(1)
  @ApiProperty({ example: 10 })
  quantityClasses: number;
}

export class ShiftDetailDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(validShifts)
  @ApiProperty({ example: validShifts[0] })
  name: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Invalid hour format, HH:mm required',
  })
  @ApiProperty({ example: '08:00' })
  startTime: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Invalid hour format, HH:mm required',
  })
  @ApiProperty({ example: '12:30' })
  endTime: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ClassToAreaDto)
  classesToAreas: ClassToAreaDto[];
}

export class ConfigurationDto {
  @IsString()
  @Matches(/^@.{4,}\..+$/, {
    message: 'Invalid email domain, it should be in the format @example.com',
  })
  @ApiProperty({ example: '@example.com' })
  emailDomain: string;

  @IsBoolean()
  createSchedules: boolean;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ShiftDetailDto)
  shifts: ShiftDetailDto[];
}

export class ProcessAdmissionDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'Ciclo Quintos' })
  name: string;

  @IsInt()
  @Min(2024)
  @ApiProperty({ example: 2025 })
  year: number;

  @IsString()
  @IsIn(validSedes)
  @ApiProperty({ example: validSedes[0] })
  sede: string;

  @IsDate()
  @Type(() => Date)
  started: Date;

  @IsDate()
  @Type(() => Date)
  finished: Date;

  @ValidateNested()
  @Type(() => ConfigurationDto)
  configuration: ConfigurationDto;
}
