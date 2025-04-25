import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class SupervisorGetSummaryDto {
  @ApiProperty({
    description: 'ID único del supervisor',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Primer nombre del supervisor',
    example: 'Carlos',
  })
  @Expose()
  firstName: string;

  @ApiProperty({
    description: 'Apellido del supervisor',
    example: 'Gómez',
  })
  @Expose()
  lastName: string;

  @ApiProperty({
    description: 'Correo electrónico personal del supervisor',
    nullable: true,
    example: 'carlos.gomez@gmail.com',
  })
  @Expose()
  personalEmail: string | null;

  @ApiProperty({
    description: 'Número de teléfono del supervisor',
    nullable: true,
    example: '+51987654321',
  })
  @Expose()
  phone: string | null;

  @ApiProperty({
    description: 'ID del turno asociado al supervisor',
    nullable: true,
    example: 1,
  })
  @Expose()
  shiftId: number | null;
}
