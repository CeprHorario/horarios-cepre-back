import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class MonitorInformationDto {
  @IsUUID()
  monitorId: string;

  @IsString()
  @ApiProperty({ example: 'Juan' })
  nombres: string;

  @IsString()
  @ApiProperty({ example: 'Pérez Pérez' })
  apellidos: string;

  @IsString()
  @ApiProperty({ example: 'S-310' })
  salon: string;

  @IsUUID()
  salon_id: string;

  @IsString()
  @ApiProperty({ example: 'https://meet.google.com/abc-defg-hij' })
  urlMeet: string;

  @IsString()
  @ApiProperty({example: 'https://classroom.google.com/c/abc-defg-hij' })
  urlClassroom: string;
}
