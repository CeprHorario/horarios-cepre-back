import { BadRequestException } from '@nestjs/common';

export function assertSchemaName(name: string): void {
  if (
    typeof name !== 'string' ||
    !/^[a-z][a-z0-9_]{0,47}$/.test(name) ||
    name === 'public' ||
    name.startsWith('pg_') ||
    name === 'information_schema'
  ) {
    throw new BadRequestException('Invalid process schema name');
  }
}
