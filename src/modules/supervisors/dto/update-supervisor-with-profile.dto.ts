import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateSupervisorWithProfileDto {
  @IsString()
  @IsOptional()
  @ApiProperty({ example: 'John' })
  firstName?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ example: 'Perez Perez' })
  lastName?: string;

  @IsEmail()
  @IsOptional()
  personalEmail?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ example: '987654321' })
  phone?: string;
}
