import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class MonitorGetByIdDto {
  @ApiProperty({
    description: 'ID único del monitor',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @Expose()
  monitorId: string;

  @ApiProperty({
    description: 'Primer nombre del monitor',
    example: 'Juan',
  })
  @Expose()
  firstName: string;

  @ApiProperty({
    description: 'Apellido del monitor',
    example: 'Pérez',
  })
  @Expose()
  lastName: string;

  @ApiProperty({
    description: 'Correo electrónico del monitor',
    example: 'juan.perez@universidad.edu',
  })
  @Expose()
  email: string;

  @ApiProperty({
    description: 'Correo personal del monitor',
    example: 'juan.perez@gmail.com',
  })
  @Expose()
  personalEmail: string;

  @ApiProperty({
    description: 'Teléfono del monitor',
    example: '+123456789',
  })
  @Expose()
  phone: string;
}
