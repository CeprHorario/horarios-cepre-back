import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Expose } from 'class-transformer';

// DTO para respuesta que incluye el ID
export class ClassForSupervisorDto {
  @Expose()
  @IsNotEmpty()
  @IsString()
  @MaxLength(48)
  @ApiProperty({ example: 'S-213 Sociales' })
  name!: string;

  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(48)
  @ApiProperty({ example: 'https://meet.google.com/abc-123-def' })
  urlMeet?: string;

  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiProperty({ example: 'https://meet.google.com/abc-123-def-zzz' })
  urlClassroom?: string;
}
