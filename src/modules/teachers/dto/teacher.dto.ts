import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
  IsNumber,
  IsPositive,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { User, JobStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { CourseDto } from '@modules/courses/dto';

// DTO para respuesta que incluye el ID
export class TeacherDto {
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  readonly id!: string;

  @IsNotEmpty()
  @IsString()
  @IsUUID()
  userId!: string;

  @IsOptional()
  user: User; //CAMBIAR POR DTO A FUTURO

  @IsNotEmpty()
  @IsNumber()
  @ApiProperty({ example: 2 })
  courseId!: number;

  @IsOptional()
  course: CourseDto; //CAMBIAR POR DTO A FUTURO

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  @ApiProperty({ example: 30 })
  maxHours: number;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  @ApiProperty({ example: 30 })
  scheduledHours: number;

  @IsNotEmpty()
  @IsBoolean()
  @ApiProperty({ example: true })
  isCoordinator: boolean;

  @ApiProperty({
    description: 'Fecha de creación del teacher',
    example: '2023-10-01T12:00:00Z',
  })
  @IsDateString(
    {},
    { message: 'La fecha de creación debe ser una cadena de fecha válida.' },
  )
  @IsNotEmpty({ message: 'La fecha de creación no puede estar vacía.' })
  createdAt: string;

  @ApiProperty({
    description: 'Fecha de última actualización del teacher',
    example: '2023-10-01T12:00:00Z',
  })
  @IsDateString(
    {},
    {
      message: 'La fecha de actualización debe ser una cadena de fecha válida.',
    },
  )
  @IsNotEmpty({ message: 'La fecha de actualización no puede estar vacía.' })
  updatedAt: string;

  @ApiProperty({
    description: 'inidica el docente esta activo',
    example: true,
  })
  @IsBoolean({ message: 'El campo isActive debe ser un valor booleano.' })
  @IsNotEmpty({ message: 'El campo isActive no puede estar vacío.' })
  isActive: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsEnum(JobStatus)
  @ApiProperty({ example: 'FullTime' })
  jobStatus!: JobStatus;
}
