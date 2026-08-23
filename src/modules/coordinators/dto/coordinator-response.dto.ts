import { ApiProperty } from '@nestjs/swagger';

export class CoordinatorResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'coordinador.mate@cepre.edu.pe' })
  email: string;

  @ApiProperty({ example: 'coordinador-1' })
  role: string;

  @ApiProperty({ example: 1, nullable: true })
  courseId: number | null;

  @ApiProperty({ example: 'Matematica', nullable: true })
  courseName: string | null;

  @ApiProperty({ example: '12345678', nullable: true })
  dni: string | null;

  @ApiProperty({ example: 'Juan' })
  firstName: string;

  @ApiProperty({ example: 'Perez' })
  lastName: string;

  @ApiProperty({ example: '987654321', nullable: true })
  phone: string | null;

  @ApiProperty({ example: ['987654321'], type: [String] })
  phonesAdditional: string[];

  @ApiProperty({ example: 'personal@ejemplo.com', nullable: true })
  personalEmail: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;
}
