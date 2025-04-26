import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class SupervisorGetByIdDto {
  @ApiProperty({
    description: 'ID único del supervisor',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @Expose()
  supervisorId: string;

  @ApiProperty({
    description: 'Primer nombre del supervisor',
    example: 'Juan',
  })
  @Expose()
  firstName: string;

  @ApiProperty({
    description: 'Apellido del supervisor',
    example: 'Pérez',
  })
  @Expose()
  lastName: string;

  @ApiProperty({
    description: 'Correo electrónico del supervisor',
    example: 'juan.perez@universidad.edu',
  })
  @Expose()
  email: string;

  @ApiProperty({
    description: 'Correo personal del supervisor',
    example: 'juan.perez@gmail.com',
  })
  @Expose()
  personalEmail: string;

  @ApiProperty({
    description: 'Teléfono del supervisor',
    example: '+123456789',
  })
  @Expose()
  phone: string;

}
