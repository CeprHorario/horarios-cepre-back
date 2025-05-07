import * as rawData from '@database/prisma/data/initial.json';
import { DataInitial } from '@database/prisma/data/type';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, Min } from 'class-validator';

const dataInitial = rawData as DataInitial;
const validAreas: string[] = dataInitial.areas.map((area) => area.name);
const validShifts: string[] = dataInitial.shifts.map((shift) => shift.name);

export class CreateClassDataDto {
  @IsNumber()
  @Min(101)
  @ApiProperty({ example: 101 })
  number: number;

  @IsString()
  @IsIn(validAreas)
  @ApiProperty({ example: validAreas[0] })
  area: string;

  @IsString()
  @IsIn(validShifts)
  @ApiProperty({ example: validShifts[0] })
  shift: string;
}
