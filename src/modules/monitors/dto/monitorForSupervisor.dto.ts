import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { Expose, Transform } from 'class-transformer';
import { UserProfileForTeacherDto } from '@modules/user-profile/dto/user-profile-for-teacher.dto';
import { ApiProperty } from '@nestjs/swagger';
import { ClassForSupervisorDto } from '@modules/classes/dto/classForSupervisor.dto';

// DTO para respuesta que incluye el ID
export class MonitorForSupervisorDto {
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  @Expose()
  readonly id!: string;

  @Expose()
  @IsOptional()
  @Transform(({ value }: { value: UserProfileForTeacherDto }) =>
    value ? { firstName: value.firstName, lastName: value.lastName } : null,
  )
  user: { firstName: string; lastName: string } | null;

  @Expose()
  @IsOptional()
  @ApiProperty({ type: [ClassForSupervisorDto] })
  classes?: ClassForSupervisorDto;
}
