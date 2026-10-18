import { SetMetadata } from '@nestjs/common';
export const SCHEMA_ROUTING_BYPASS_KEY = 'schemaRoutingBypass';
export const SchemaRoutingBypass = () =>
  SetMetadata(SCHEMA_ROUTING_BYPASS_KEY, true);
