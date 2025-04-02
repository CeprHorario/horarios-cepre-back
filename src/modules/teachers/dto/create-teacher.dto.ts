import { IsEmail, IsNotEmpty, IsNumber, IsString, IsEnum, IsArray, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JobStatus } from '@prisma/client';

export class CreateTeacherWithUserDto {
    @ApiProperty({ example: 'teacher@example.com' })
    @IsEmail()
    @IsNotEmpty()
    email: string;
  
    @ApiProperty({ example: 30 })
    @IsNumber()
    @IsNotEmpty()
    maxHours: number;
  
    @ApiProperty({ example: 0 })
    @IsNumber()
    @IsNotEmpty()
    scheduledHours: number;

    @ApiProperty({ 
        example: 'FullTime', 
        enum: JobStatus,
        description: 'Estado laboral del profesor (FullTime, PartTime, FreeTime)'
    })
    @IsEnum(JobStatus)
    @IsNotEmpty()
    jobStatus: JobStatus;
  
    @ApiProperty({ example: 3 })
    @IsNumber()
    @IsNotEmpty()
    courseId: number;
  
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
      type: [String] 
    })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    phonesAdditional?: string[];
  
    @ApiProperty({ example: 'personal@ejemplo.com', required: false })
    @IsEmail()
    @IsOptional()
    personalEmail?: string;
  }



  