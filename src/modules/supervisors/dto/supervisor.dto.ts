import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
} from 'class-validator';
import { User } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

// DTO para respuesta que incluye el ID
export class SupervisorDto {
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  readonly id!: string;

  @IsNotEmpty()
  @IsString()
  @IsUUID()
  userId!: string;

  @IsOptional()
  user: User; //CAMBIAR POR DTO A FUTURO

  @ApiProperty({
    description: 'Fecha de creación del supervisor',
    example: '2023-10-01T12:00:00Z',
  })
  @IsDateString({}, { message: 'La fecha de creación debe ser una cadena de fecha válida.' })
  @IsNotEmpty({ message: 'La fecha de creación no puede estar vacía.' })
  createdAt: string;

  @ApiProperty({
    description: 'Fecha de última actualización del supervisor',
    example: '2023-10-01T12:00:00Z',
  })
  @IsDateString({}, { message: 'La fecha de actualización debe ser una cadena de fecha válida.' })
  @IsNotEmpty({ message: 'La fecha de actualización no puede estar vacía.' })
  updatedAt: string;  

}
