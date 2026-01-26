import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { JobStatus } from '@prisma/client';

export class TeacherGetSummaryDto {
  @ApiProperty({
    description: 'ID único del profesor',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Nombre del curso que enseña el profesor',
    example: 'Matemáticas',
  })
  @Expose()
  courseName: string;

  @ApiProperty({
    description: 'Primer nombre del profesor',
    example: 'Juan',
  })
  @Expose()
  firstName: string;

  @ApiProperty({
    description: 'Apellido del profesor',
    example: 'Pérez',
  })
  @Expose()
  lastName: string;

  @ApiProperty({
    description: 'Correo electrónico personal del profesor',
    nullable: true,
    example: 'juan.perez@gmail.com',
  })
  @Expose()
  personalEmail: string | null;

  @ApiProperty({
    description: 'Número de teléfono del profesor',
    nullable: true,
    example: '+51987654321',
  })
  @Expose()
  phone: string | null;

  @ApiProperty({
    description: 'Estado laboral del profesor',
    example: 'Activo',
    enum: JobStatus,
  })
  @Expose()
  jobStatus: JobStatus;

  @ApiProperty({
    description: 'Indica si el profesor es coordinador',
    example: true,
  })
  @Expose()
  isCoordinator: boolean;

  @ApiProperty({
    description: 'Horas máximas de enseñanza',
    nullable: true,
    example: 20,
  })
  @Expose()
  maxHours: number | null;

  @Expose()
  scheduledHours: number;
}
