import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsEmail, Length } from 'class-validator';

export class TeacherResponseDto {
  @ApiProperty({
    example: 'a12b3c4d-567e-8f90-1234-56789abcdef',
    description: 'Identificador único del docente',
  })
  @IsUUID('4', { message: 'El ID del docente debe ser un UUID válido' })
  teacherId: string;

  @ApiProperty({
    example: 'Juan',
    description: 'Nombre del docente',
  })
  @IsString({ message: 'El nombre del docente debe ser un texto' })
  @Length(2, 50, { message: 'El nombre debe tener entre 2 y 50 caracteres' })
  firstName: string;

  @ApiProperty({
    example: 'Pérez',
    description: 'Apellido del docente',
  })
  @IsString({ message: 'El apellido del docente debe ser un texto' })
  @Length(2, 50, { message: 'El apellido debe tener entre 2 y 50 caracteres' })
  lastName: string;

  @ApiProperty({
    example: 'juan.perez@example.com',
    description: 'Correo electrónico del docente',
  })
  @IsEmail({}, { message: 'Debe ser un correo electrónico válido' })
  email: string;

  @ApiProperty({
    example: 'Matemáticas',
    description: 'Nombre del curso que dicta el docente',
  })
  @IsString({ message: 'El nombre del curso debe ser un texto' })
  @Length(2, 48, { message: 'El nombre del curso debe tener entre 2 y 48 caracteres' })
  courseName: string;

  @ApiProperty({
    example: '987654321',
    description: 'Número de teléfono del docente',
   
  })
  phone?: string; 
}
