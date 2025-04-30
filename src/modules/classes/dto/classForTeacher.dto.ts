//CAMBIAR POR DTOS  A FUTURO
import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MonitorForTeacherDto } from '@modules/monitors/dto/monitorForTeacher.dto';

import { ScheduleForTeacherDto } from '@modules/schedules/dto/scheduleForTeacher.dto';
import { Expose, Transform } from 'class-transformer';
import { AreaDto } from '@modules/areas/dto';

// DTO para respuesta que incluye el ID
export class ClassForTeacherDto {
  @Expose()
  @IsNotEmpty()
  @IsString()
  @MaxLength(48)
  @ApiProperty({ example: 'S-213 Sociales' })
  name!: string;

  @Expose()
  @IsOptional()
  @ApiProperty({ type: [MonitorForTeacherDto] })
  monitor: MonitorForTeacherDto;

  @Expose()
  @Transform(({ value }: { value: AreaDto }) => value.name)
  area: AreaDto;

  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(48)
  @ApiProperty({ example: 'https://meet.google.com/abc-123-def' })
  urlMeet?: string;

  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiProperty({ example: 'https://meet.google.com/abc-123-def-zzz' })
  urlClassroom?: string;

  @Expose()
  @IsOptional()
  @ApiProperty({ type: [ScheduleForTeacherDto] })
  schedules?: ScheduleForTeacherDto[];
}
