import {
  pgTable,
  smallint,
  varchar,
  serial,
  timestamp,
  uniqueIndex,
  primaryKey,
  smallserial,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Modelo AdmisionProcess
export const admissionProcesses = pgTable(
  'admission_processes',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 64 }).notNull(),
    isCurrent: boolean('is_current').default(true).notNull(),
    year: varchar('db_year', { length: 4 }).notNull(),
    description: varchar('description', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('admission_process_name_unique').on(table.name)],
);

// Relaciones para AdmisionProcess
export const admissionProcessesRelations = relations(
  admissionProcesses,
  ({ many }) => ({
    observations: many(observations),
  }),
);

// Modelo Observation
export const observations = pgTable('observations', {
  id: serial('id').primaryKey(),
  description: varchar('description', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  admissionProcessId: smallserial('admission_process_id')
    .notNull()
    .references(() => admissionProcesses.id, { onDelete: 'cascade' }),
});

// Relaciones para Observation
export const observationsRelations = relations(observations, ({ one }) => ({
  admissionProcess: one(admissionProcesses, {
    fields: [observations.admissionProcessId],
    references: [admissionProcesses.id],
  }),
}));

// Modelo Role
export const roles = pgTable(
  'roles',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 48 }).notNull(),
    description: varchar('description', { length: 255 }),
    createdAt: timestamp('created_at', { precision: 3 }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('role_name_unique').on(table.name)],
);

// Relaciones para Role
export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolesPermissions),
}));

// Modelo Permission
export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 48 }).notNull().unique(),
  path: varchar('path', { length: 128 }).notNull(),
  methodHttp: varchar('method_http', { length: 16 }).notNull(),
  description: varchar('description', { length: 255 }),
  createdAt: timestamp('created_at', { precision: 3 }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { precision: 3 }).defaultNow().notNull(),
});

// Relaciones para Permission
export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolesPermissions),
}));

// Modelo RolePermission (tabla de unión)
export const rolesPermissions = pgTable(
  'roles_permissions',
  {
    roleId: smallint('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: integer('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    uniqueIndex('role_permission_unique').on(table.roleId, table.permissionId),
  ],
);

// Relaciones para RolePermission
export const rolesPermissionsRelations = relations(
  rolesPermissions,
  ({ one }) => ({
    role: one(roles, {
      fields: [rolesPermissions.roleId],
      references: [roles.id],
    }),
    permission: one(permissions, {
      fields: [rolesPermissions.permissionId],
      references: [permissions.id],
    }),
  }),
);
