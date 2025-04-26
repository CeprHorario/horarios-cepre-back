import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { Expose } from 'class-transformer';

export class UpdateSupervisorWithProfileDto {
  @IsString()
  @IsOptional()
  @ApiProperty({ example: 'John' })
  firstName?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ example: 'Perez Perez' })
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @Expose()
  @ApiProperty({
    description: 'Correo electrónico institucional del monitor',
    nullable: true,
    example: 'luis.martinez@gmail.com',
  })
  email?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ example: '987654321' })
  phone?: string;
}
