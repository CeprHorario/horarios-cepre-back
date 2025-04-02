import { IsString, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class UserProfileEditDto {
  @ApiProperty({
    description: 'Nombre del usuario',
    example: 'Juan',
  })
  @Expose()
  @IsString()
  firstName: string;

  @ApiProperty({
    description: 'Apellido del usuario',
    example: 'Pérez',
  })
  @IsString()
  @Expose()
  lastName: string;

  @ApiPropertyOptional({
    description: 'Teléfono del usuario',
    example: '987654321',
  })
  @IsOptional()
  @IsString()
  @Expose()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Correo electrónico personal del usuario',
    example: 'personal@ejemplo.com',
  })
  @IsOptional()
  @IsEmail()
  @Expose()
  personalEmail?: string;
}
