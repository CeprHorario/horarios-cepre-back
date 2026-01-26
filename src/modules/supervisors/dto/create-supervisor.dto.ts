import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsArray,
  IsOptional,
  IsNumber,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSupervisorWithUserDto {
  @ApiProperty({ example: 'supervisor@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiProperty({ example: 'Juan' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Pérez' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: '987654321', required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    example: ['987654321', '123456789'],
    required: false,
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  phonesAdditional?: string[];

  @ApiProperty({ example: 'personal@ejemplo.com', required: false })
  @IsEmail()
  @IsOptional()
  personalEmail?: string;

  @ApiProperty({ example: '1', required: false })
  @IsNumber()
  @IsOptional()
  shift_id?: number;
}
