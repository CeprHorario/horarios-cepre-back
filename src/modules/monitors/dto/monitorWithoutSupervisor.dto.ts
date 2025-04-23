import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsUUID } from 'class-validator';

export class MonitorWithoutSupervisorDto {
  @IsUUID()
  monitorId: string;

  @IsString()
  @ApiProperty({ example: 'I-101 Ingenierías' })
  className: string;

  @IsNumber()
  @ApiProperty({ example: 123 })
  shiftId: number;

  @IsString()
  @ApiProperty({ example: 'Turno 01' })
  shiftName: string;

  @IsNumber()
  @ApiProperty({ example: 132 })
  areaId: number;

  @IsString()
  @ApiProperty({ example: 'Ingenierías' })
  areaName: string;
}
