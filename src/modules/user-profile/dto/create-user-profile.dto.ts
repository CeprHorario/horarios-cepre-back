import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEmail,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserProfileDto {
  @ApiProperty({
    description: 'DNI del usuario',
    example: '12345678'
  })
  @IsString()
  dni: string;

  @ApiProperty({
    description: 'Nombre del usuario',
    example: 'Juan'
  })
  @IsString()
  firstName: string;

  @ApiProperty({
    description: 'Apellido del usuario',
    example: 'Pérez'
  })
  @IsString()
  lastName: string;

  @ApiPropertyOptional({
    description: 'Teléfono del usuario',
    example: '987654321'
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: 'Teléfonos adicionales del usuario',
    example: ['987654321', '123456789']
  })
  @IsArray()
  @IsString({ each: true })
  phonesAdditional: string[];

  @ApiPropertyOptional({
    description: 'Correo electrónico personal del usuario',
    example: 'personal@ejemplo.com'
  })
  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @ApiProperty({
    description: 'Estado activo del usuario',
    example: true
  })
  @IsBoolean()
  isActive: boolean;
}
