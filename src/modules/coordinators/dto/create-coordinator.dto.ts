import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCoordinatorDto {
  @ApiProperty({ example: 'coordinador.mate@cepre.edu.pe' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 1,
    required: false,
    description: 'ID del curso asignado. Omitir para coordinador general',
  })
  @IsInt()
  @IsOptional()
  courseId?: number;

  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiProperty({ example: 'Juan' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Perez' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: '987654321', required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    example: ['987654321', '123456789'],
    required: false,
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  phonesAdditional?: string[];

  @ApiProperty({ example: 'personal@ejemplo.com', required: false })
  @IsEmail()
  @IsOptional()
  personalEmail?: string;
}
