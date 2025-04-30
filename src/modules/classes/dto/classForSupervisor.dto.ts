import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Expose } from 'class-transformer';

// DTO para respuesta que incluye el ID
export class ClassForSupervisorDto {
  @Expose()
  @IsNotEmpty()
  @IsString()
  @MaxLength(48)
  @ApiProperty({ example: 'A-101', description: 'Nombre de la clase' })
  name!: string;

  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(48)
  @ApiProperty({
    example: 'https://meet.google.com/xyz-abcd-123',
    description: 'URL de Google Meet para esta clase',
  })
  urlMeet?: string;

  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiProperty({
    example: 'https://classroom.google.com/c/abc123456',
    description: 'URL de Google Classroom para esta clase',
  })
  urlClassroom?: string;
}
