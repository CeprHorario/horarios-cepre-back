import { IsNotEmpty, IsString, IsOptional, IsEmail } from 'class-validator';
import { Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// DTO para respuesta que incluye el ID
export class UpdateMonitorAsAdminDto {
  @IsNotEmpty()
  @IsString()
  @Expose()
  @ApiProperty({
    description: 'Primer nombre del monitor',
    example: 'Luis',
  })
  firstName!: string;

  @IsNotEmpty()
  @IsString()
  @Expose()
  @ApiProperty({
    description: 'Apellido del monitor',
    example: 'Martínez',
  })
  lastName!: string;

  @IsOptional()
  @IsEmail()
  @Expose()
  @ApiProperty({
    description: 'Correo electrónico institucional del monitor',
    nullable: true,
    example: 'luis.martinez@gmail.com',
  })
  personalEmail?: string;

  @IsOptional()
  @IsString()
  @Expose()
  @ApiProperty({
    description: 'Número de teléfono del monitor',
    nullable: true,
    example: '+51987654321',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @Expose()
  @ApiProperty({
    description: 'ID de la clase asignada al monitor',
    nullable: true,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  classId?: string;

  @IsOptional()
  @IsString()
  @Expose()
  @ApiProperty({
    description: 'Nombre de la clase asignada al monitor',
    nullable: true,
    example: 'Matemáticas 101',
  })
  className?: string;

  @IsOptional() // Cambiar a opcional
  @IsString()
  @Expose()
  @ApiProperty({
    description: 'DNI del monitor',
    nullable: true, // Indicar que es opcional
    example: '12345678',
  })
  dni?: string; // Cambiar a opcional
}
