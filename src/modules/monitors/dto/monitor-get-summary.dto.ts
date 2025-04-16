import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class MonitorGetSummaryDto {
  @ApiProperty({
    description: 'ID único del monitor',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Primer nombre del monitor',
    example: 'Luis',
  })
  @Expose()
  firstName: string;

  @ApiProperty({
    description: 'Apellido del monitor',
    example: 'Martínez',
  })
  @Expose()
  lastName: string;

  @ApiProperty({
    description: 'Correo electrónico personal del monitor',
    nullable: true,
    example: 'luis.martinez@gmail.com',
  })
  @Expose()
  personalEmail: string | null;

  @ApiProperty({
    description: 'Número de teléfono del monitor',
    nullable: true,
    example: '+51987654321',
  })
  @Expose()
  phone: string | null;

  @ApiProperty({
    description: 'Nombre de la clase asignada al monitor',
    example: 'Matemáticas 101',
  })
  @Expose()
  className: string | null;
}
