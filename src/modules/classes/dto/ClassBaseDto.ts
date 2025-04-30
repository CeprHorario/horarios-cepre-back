import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

export class ClassBaseDto {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  idSede: number;

  @Expose()
  areaId: number;

  @Expose()
  shiftId: number;

  @Expose()
  monitorId?: string;

  @Expose()
  capacity: number;

  @Expose()
  urlMeet?: string;

  @Expose()
  urlClassroom?: string;

  @Expose()
  @IsOptional()
  @IsString()
  @ApiProperty({ example: 'COMPLETO', enum: ['COMPLETO', 'FALTAN_DOCENTES'] })
  status?: string;

  @Expose()
  sede?: any;

  @Expose()
  area?: any;

  @Expose()
  shift?: any;

  @Expose()
  monitor?: any;

  @Expose()
  schedules?: any[];
}
