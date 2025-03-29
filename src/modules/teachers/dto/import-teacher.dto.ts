import { IsEmail, IsNotEmpty, IsOptional, IsString, IsBoolean, IsArray, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { JobStatus } from '@prisma/client';

@Expose()
export class ImportTeacherDto {
  @ApiProperty({
    description: 'Correo electrónico del profesor',
    example: 'profesor@ejemplo.com'
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'DNI del profesor',
    example: '12345678'
  })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiProperty({
    description: 'Nombre del profesor',
    example: 'Juan'
  })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({
    description: 'Apellido del profesor',
    example: 'Pérez'
  })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({
    description: 'Teléfono del profesor',
    example: '987654321'
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Teléfonos adicionales del profesor',
    example: ['987654321', '123456789']
  })
  @IsArray()
  @IsOptional()
  phonesAdditional?: string[];

  @ApiPropertyOptional({
    description: 'Correo electrónico personal del profesor',
    example: 'personal@ejemplo.com'
  })
  @IsEmail()
  @IsOptional()
  personalEmail?: string;

  @ApiProperty({
    description: 'Estado activo del profesor',
    example: true
  })
  @IsBoolean()
  isActive?: boolean = true;
  
  @ApiProperty({
    description: 'Tipo de turno del profesor',
    example: 'FULL_TIME'
  })
  @IsEnum(JobStatus, { message: 'El tipo de turno debe ser FULL_TIME o PART_TIME' })
  jobStatus: JobStatus; 

  @ApiProperty({
    description: 'Nombre del curso al que pertenece el profesor',
    example: 'Matemáticas'
  })
  @IsString({ message: 'El nombre del curso debe ser un texto' })
  courseName: string;
}
