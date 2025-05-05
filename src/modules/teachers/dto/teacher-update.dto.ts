import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsBoolean, IsNumber } from 'class-validator';
import { JobStatus } from '@prisma/client';

export class TeacherUpdateDto {
  @ApiProperty({
    description: 'Nombre del curso que enseña el profesor',
    example: 'Literatura',
  })
  @IsString()
  @IsOptional()
  courseName: string;

  @ApiProperty({
    description: 'Primer nombre del profesor',
    example: 'Julio',
  })
  @IsString()
  firstName: string;

  @ApiProperty({
    description: 'Apellido del profesor',
    example: 'Velarde',
  })
  @IsString()
  lastName: string;

  @ApiProperty({
    description: 'Correo electrónico institucional del profesor',
    nullable: true,
    example: 'jverde.dev@gmail.com',
  })
  @IsOptional()
  @IsString()
  email: string;

  @ApiProperty({
    description: 'Número de teléfono del profesor',
    nullable: true,
    example: '912345678',
  })
  @IsOptional()
  @IsString()
  phone: string | null;

  @ApiProperty({
    description: 'Estado laboral del profesor',
    example: 'FullTime',
    enum: JobStatus,
  })
  @IsEnum(JobStatus)
  @IsOptional()
  jobStatus: JobStatus;

  @ApiProperty({
    description: 'Indica si el profesor es coordinador',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isCoordinator: boolean;

  @ApiProperty({
    description: 'Horas máximas de enseñanza',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  maxHours?: number;
}
