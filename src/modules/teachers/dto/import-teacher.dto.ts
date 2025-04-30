// create-teacher.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  IsArray,
  IsNumber,
} from 'class-validator';
import { JobStatus } from '@prisma/client';

export class CreateTeacherDto {
  @ApiProperty({ example: 'profesor1@ejemplo.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Juan' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  firstName: string;

  @ApiProperty({ example: 'Pérez' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  lastName: string;

  @ApiProperty({ example: '12345678', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  dni?: string;

  @ApiProperty({ example: '987654321', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  phone?: string;

  @ApiProperty({ example: ['998877665'], required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phonesAdditional?: string[];

  @ApiProperty({ example: 'juan.perez@correo.com', required: false })
  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  courseId: number;

  @ApiProperty({ example: 12, required: false })
  @IsOptional()
  @IsNumber()
  maxHours?: number;

  @ApiProperty({ enum: JobStatus, example: JobStatus.FullTime })
  @IsEnum(JobStatus)
  jobStatus: JobStatus;
}
