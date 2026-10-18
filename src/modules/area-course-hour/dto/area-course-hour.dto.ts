import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsPositive } from 'class-validator';

//CAMBIAR POR DTOS  A FUTURO
import { Course, Area } from '../../../generated/prisma/client';

// DTO con todas las propiedades
export class AreaCourseHourDto {
  @IsNotEmpty()
  @IsNumber()
  @ApiProperty({ example: 123 })
  readonly id!: number;

  @IsNotEmpty()
  @IsNumber()
  @ApiProperty({ example: 220 })
  areaId!: number;

  @IsOptional()
  area?: Area; //CAMBIAR POR DTO A FUTURO

  @IsNotEmpty()
  @IsNumber()
  @ApiProperty({ example: 125 })
  courseId!: number;

  @IsOptional()
  course?: Course; //CAMBIAR POR DTO A FUTURO

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  @ApiProperty({ example: 12 })
  totalHours!: number;
}
