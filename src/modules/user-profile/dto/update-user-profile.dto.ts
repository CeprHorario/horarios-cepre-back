import { PartialType } from '@nestjs/mapped-types';
import { CreateUserProfileDto } from './create-user-profile.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserProfileDto extends PartialType(CreateUserProfileDto) {
  @ApiPropertyOptional({
    description: 'DNI del usuario',
    example: '12345678'
  })
  dni?: string;

  @ApiPropertyOptional({
    description: 'Nombre del usuario',
    example: 'Juan'
  })
  firstName?: string;

  @ApiPropertyOptional({
    description: 'Apellido del usuario',
    example: 'Pérez'
  })
  lastName?: string;

  @ApiPropertyOptional({
    description: 'Teléfono del usuario',
    example: '987654321'
  })
  phone?: string;

  @ApiPropertyOptional({
    description: 'Teléfonos adicionales del usuario',
    example: ['987654321', '123456789']
  })
  phonesAdditional?: string[];

  @ApiPropertyOptional({
    description: 'Correo electrónico personal del usuario',
    example: 'personal@ejemplo.com'
  })
  personalEmail?: string;

  @ApiPropertyOptional({
    description: 'Estado activo del usuario',
    example: true
  })
  isActive?: boolean;
}
