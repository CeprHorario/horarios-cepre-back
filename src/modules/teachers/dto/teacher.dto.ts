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
  @ApiProperty({ example: false })
  isCoordinator: boolean;

  @ApiProperty({
    description: 'Fecha de creación del supervisor',
    example: '2023-10-01T12:00:00Z',
    readOnly: true, // Marcar como solo lectura en Swagger
  })
  @IsDateString(
    {},
    { message: 'La fecha de creación debe ser una cadena de fecha válida.' },
  )
  @IsOptional() // Cambiado a Optional ya que será manejado por el servicio
  createdAt?: string;

  @ApiProperty({
    description: 'Fecha de última actualización del supervisor',
    example: '2023-10-01T12:00:00Z',
    readOnly: true, // Marcar como solo lectura en Swagger
  })
  @IsDateString(
    {},
    {
      message: 'La fecha de actualización debe ser una cadena de fecha válida.',
    },
  )
  @IsOptional() // Cambiado a Optional ya que será manejado por el servicio
  updatedAt?: string;

  @IsOptional()
  @IsNotEmpty()
  @IsEnum(JobStatus)
  jobStatus!: JobStatus;
}
