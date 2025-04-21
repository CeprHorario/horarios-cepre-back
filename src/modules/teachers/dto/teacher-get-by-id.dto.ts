import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class TeacherGetByIdDto {
  @ApiProperty({
    description: 'ID único del profesor',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @Expose()
  teacherId: string;

  @ApiProperty({
    description: 'Primer nombre del profesor',
    example: 'Juan',
  })
  @Expose()
  firstName: string;

  @ApiProperty({
    description: 'Apellido del profesor',
    example: 'Pérez',
  })
  @Expose()
  lastName: string;

  @ApiProperty({
    description: 'Correo electrónico del profesor',
    example: 'juan.perez@universidad.edu',
  })
  @Expose()
  email: string;

  @ApiProperty({
    description: 'Correo personal del profesor',
    example: 'juan.perez@gmail.com',
  })
  @Expose()
  personalEmail: string;

  @ApiProperty({
    description: 'Teléfono del profesor',
    example: '+123456789',
  })
  @Expose()
  phone: string;

  @ApiProperty({
    description: 'ID del curso que enseña el profesor',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Expose()
  courseId: string;

  @ApiProperty({
    description: 'Nombre del curso que enseña el profesor',
    example: 'Matemáticas',
  })
  @Expose()
  courseName: string;
}
