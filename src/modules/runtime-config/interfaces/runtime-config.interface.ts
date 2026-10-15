export interface RuntimeActor {
  id: string;
  email: string;
}

export interface MaintenanceConfig {
  enabled: boolean;
  message: string;
  endsAt: string | null;
}

export interface SchemaRoutingConfig {
  adminSchema: string;
  userSchema: string;
}

export interface RuntimeConfig {
  version: number;
  maintenance: MaintenanceConfig;
  schemaRouting: SchemaRoutingConfig;
  updatedAt: string | null;
  updatedBy: RuntimeActor;
  changeReason: string;
}

export interface UpdateRuntimeConfigInput {
  expectedVersion: number;
  maintenance: MaintenanceConfig;
  schemaRouting: SchemaRoutingConfig;
  changeReason: string;
}
