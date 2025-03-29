import { Role } from '@modules/auth/decorators/authorization.decorator';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UserDto {
  @IsUUID()
  @IsNotEmpty()
  id!: string;

  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  password: string;

  @IsNotEmpty()
  @IsBoolean()
  isActive: boolean;

  @IsEnum(Role)
  @IsNotEmpty()
  @IsString()
  role!: Role;

  @IsOptional()
  @IsDate()
  lastLogin: Date;

  @IsOptional()
  @IsDate()
  createdAt: Date;

  @IsOptional()
  @IsDate()
  updatedAt: Date;
}
