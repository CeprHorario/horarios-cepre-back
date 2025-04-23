import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class AssignMonitorDto {
  @ApiProperty({
    description: 'ID del monitor',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsUUID()
  id_monitor: string;

  @ApiProperty({
    description: 'ID del supervisor (opcional para desasignar)',
    example: '550e8400-e29b-41d4-a716-446655440001',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  id_supervisor?: string;
}
