import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Course, Weekday } from '../../../generated/prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { ClassDto } from '@modules/classes/dto';
import { HourSessionDto } from '@modules/hour-session/dto';
import { TeacherDto } from '@modules/teachers/dto';

// DTO para respuesta que incluye el ID
export class ScheduleDto {
  @IsNotEmpty()
  @IsNumber()
  @ApiProperty({ example: 123 })
  readonly id!: number;

  @IsNotEmpty()
  @IsString()
  @IsUUID()
  classId!: string;

  @IsOptional()
  clas: ClassDto; //CAMBIAR POR DTO A FUTURO

  @IsNotEmpty()
  @IsNumber()
  @ApiProperty({ example: 456 })
  courseId!: number;

  @IsOptional()
  course?: Course; //CAMBIAR POR DTO A FUTURO

  @IsNotEmpty()
  @IsNumber()
  @ApiProperty({ example: 456 })
  hourSessionId!: number;

  @IsOptional()
  hourSession?: HourSessionDto; //CAMBIAR POR DTO A FUTURO

  @IsOptional()
  @IsString()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  teacher?: TeacherDto; //CAMBIAR POR DTO A FUTURO

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsEnum(Weekday)
  @ApiProperty({ example: 'Lunes' })
  weekday!: Weekday;
}
