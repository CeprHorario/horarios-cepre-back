import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateCoordinatorDto {
  @ApiProperty({ example: 'coordinador.mate@cepre.edu.pe', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({
    example: 1,
    required: false,
    description:
      'ID del curso asignado. Enviar null para convertirlo en coordinador general',
  })
  @IsInt()
  @IsOptional()
  courseId?: number | null;

  @ApiProperty({ example: '12345678', required: false })
  @IsString()
  @IsOptional()
  dni?: string;

  @ApiProperty({ example: 'Juan', required: false })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({ example: 'Perez', required: false })
  @IsString()
  @IsOptional()
  lastName?: string;

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
