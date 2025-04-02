import { IsString } from 'class-validator';
import { Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UserProfileForTeacherDto {
  @Expose()
  @ApiProperty({
    description: 'Nombre del profesor',
    example: 'Juan',
  })
  @IsString()
  firstName: string;

  @Expose()
  @ApiProperty({
    description: 'Apellido del profesor',
    example: 'Pérez',
  })
  @IsString()
  lastName: string;
}
