import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const validAreas: number[] = [1, 2, 3, 4];
const validShifts: number[] = [1, 2, 3, 4];

/** Datos del monitor del salón; sin ellos se usa el correo automático */
export class CreateClassMonitorDto {
  @ApiProperty({ example: 'monitor@gmail.com', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ example: '12345678', required: false })
  @IsString()
  @IsOptional()
  dni?: string;

  @ApiProperty({ example: 'Juan', required: false })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({ example: 'Pérez', required: false })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ example: '987654321', required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: ['987654321'], required: false, type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  phonesAdditional?: string[];

  @ApiProperty({ example: 'personal@ejemplo.com', required: false })
  @IsEmail()
  @IsOptional()
  personalEmail?: string;
}

export class CreateClassDataDto {
  @IsNumber()
  @IsIn(validAreas)
  @ApiProperty({ example: validAreas[0] })
  area_id: number;

  @IsNumber()
  @IsIn(validShifts)
  @ApiProperty({ example: validShifts[0] })
  shift_id: number;

  @ApiProperty({ type: CreateClassMonitorDto, required: false })
  @ValidateNested()
  @Type(() => CreateClassMonitorDto)
  @IsOptional()
  monitor?: CreateClassMonitorDto;
}
