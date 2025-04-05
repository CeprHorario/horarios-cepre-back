import { IsNotEmpty, IsString, IsOptional, IsEmail } from 'class-validator';
import { Expose } from 'class-transformer';

// DTO para respuesta que incluye el ID
export class UpdateMonitorAsAdminDto {
  @IsNotEmpty()
  @IsString()
  @Expose()
  firstName!: string;

  @IsNotEmpty()
  @IsString()
  @Expose()
  lastName!: string;

  @IsOptional()
  @IsEmail()
  @Expose()
  personalEmail?: string;

  @IsOptional()
  @IsString()
  @Expose()
  phone?: string;
}
