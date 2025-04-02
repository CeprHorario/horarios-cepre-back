import {  OmitType, PartialType } from '@nestjs/swagger';
import { MonitorDto } from './monitor.dto';
import { MonitorInformationDto } from './monitor-information.dto';

// Exportar el DTO principal
export { MonitorDto, MonitorInformationDto };

export class MonitorBaseDto extends OmitType(MonitorDto, [
  'userId',
  'supervisorId'
] as const) {}

export class CreateMonitorDto extends OmitType(MonitorDto, [
  'id',
  'user',
  'supervisor'
] as const) {}

// DTO para actualizar un área
export class UpdateMonitorDto extends PartialType(
  OmitType(MonitorDto, ['id', 'user','supervisor'] as const),
) {}
