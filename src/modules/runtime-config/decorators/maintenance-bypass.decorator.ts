import { SetMetadata } from '@nestjs/common';

export const MAINTENANCE_BYPASS_KEY = 'maintenanceBypass';
export const MaintenanceBypass = () =>
  SetMetadata(MAINTENANCE_BYPASS_KEY, true);
