import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class GoogleAuthDto {
  @IsString()
  @IsUUID()
  @IsOptional()
  id?: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  googleId?: string;

  @IsString()
  role: string;
}

export class AuthResponseDto {
  token?: string;
}
