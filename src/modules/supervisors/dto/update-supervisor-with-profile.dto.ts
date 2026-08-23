import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNumber, IsOptional, IsString } from 'class-validator';
import { Expose } from 'class-transformer';

export class UpdateSupervisorWithProfileDto {
  @IsOptional()
  @IsEmail()
  @ApiProperty({
    description: 'Correo electronico institucional del supervisor',
    nullable: true,
    example: 'supervisor@cepre.edu.pe',
  })
  email?: string;

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
  personalEmail?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ example: '987654321' })
  phone?: string;

  @IsNumber()
  @IsOptional()
  @ApiProperty({ example: 1, required: false })
  shift_id?: number;
}
