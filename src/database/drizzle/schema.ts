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
  check,
  date,
  uuid,
  text,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const operationNotifications = pgTable('operation_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientId: uuid('recipient_id').notNull(),
  recipientOrigin: varchar('recipient_origin', {length:48}).notNull(),
  processSchema: varchar('process_schema', {length:48}).notNull(),
  kind: varchar('kind', {length:32}).notNull(),
  title: varchar('title', {length:160}).notNull(),
  message: text('message').notNull(),
  requestId: uuid('request_id'),
  dedupeKey: varchar('dedupe_key', {length:180}).notNull(),
  resolvedAt: timestamp('resolved_at', {withTimezone:true}),
  createdAt: timestamp('created_at', {withTimezone:true}).notNull().defaultNow(),
}, t=>[uniqueIndex('operation_notification_dedupe').on(t.recipientId,t.recipientOrigin,t.dedupeKey),index('operation_notifications_recipient').on(t.recipientId,t.recipientOrigin,t.processSchema,t.createdAt)]);

export const personIncidences = pgTable(
  'person_incidences',
  {
    id: uuid('id').primaryKey(),
    subjectDni: varchar('subject_dni', { length: 8 }).notNull(),
    subjectRole: varchar('subject_role', { length: 16 }).notNull(),
    subjectAccountId: uuid('subject_account_id').notNull(),
    subjectName: varchar('subject_name', { length: 260 }).notNull(),
    processSchema: varchar('process_schema', { length: 48 }).notNull(),
    recordId: integer('record_id'),
    classId: uuid('class_id'),
    title: varchar('title', { length: 120 }).notNull(),
    description: text('description').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    actor: jsonb('actor').notNull(),
    actorId: uuid('actor_id').notNull(),
    actorOrigin: varchar('actor_origin', { length: 48 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('OPEN'),
    version: integer('version').notNull().default(1),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('person_incidences_dni_created_idx').on(
      table.subjectDni,
      table.createdAt,
    ),
    index('person_incidences_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    check('person_incidence_dni', sql`${table.subjectDni} ~ '^[0-9]{8}$'`),
    check(
      'person_incidence_role',
      sql`${table.subjectRole} IN ('profesor','monitor','supervisor','administrador','coordinador')`,
    ),
    check(
      'person_incidence_status',
      sql`${table.status} IN ('OPEN','RESOLVED')`,
    ),
    check('person_incidence_version', sql`${table.version} > 0`),
  ],
);

export const personIncidenceEvents = pgTable(
  'person_incidence_events',
  {
    id: serial('id').primaryKey(),
    incidenceId: uuid('incidence_id')
      .notNull()
      .references(() => personIncidences.id, { onDelete: 'restrict' }),
    action: varchar('action', { length: 32 }).notNull(),
    actor: jsonb('actor').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('person_incidence_events_incidence_idx').on(
      table.incidenceId,
      table.id,
    ),
  ],
);

export const revokedTokens = pgTable(
  'revoked_tokens',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
  },
  (table) => [
    uniqueIndex('revoked_tokens_expiry_hash_idx').on(
      table.expiresAt,
      table.tokenHash,
    ),
  ],
);

// Modelo AdmissionProcess
export const admissionProcesses = pgTable(
  'admission_processes',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 48 }).notNull(),
    year: smallint('year').notNull(),
    isCurrent: boolean('is_current').default(true).notNull(),
    started: date('started', { mode: 'date' }).defaultNow().notNull(),
    finished: date('finished', { mode: 'date' }).defaultNow().notNull(),
    description: varchar('description', { length: 255 }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    structureVersion: varchar('structure_version', { length: 64 }).notNull(),
    sessionMinutes: smallint('session_minutes').notNull().default(40),
    breakMinutes: smallint('break_minutes').notNull().default(5),
  },
  (table) => [
    uniqueIndex('admission_process_name_unique').on(table.name),
    check('year', sql`${table.year} BETWEEN 2020 AND 2100`),
    check(
      'session_minutes_range',
      sql`${table.sessionMinutes} BETWEEN 1 AND 180`,
    ),
    check('break_minutes_range', sql`${table.breakMinutes} BETWEEN 0 AND 120`),
  ],
);

// Relaciones para admissionProcess
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
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { precision: 3, mode: 'date' })
      .defaultNow()
      .notNull(),
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
  createdAt: timestamp('created_at', { precision: 3, mode: 'date' })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { precision: 3, mode: 'date' })
    .defaultNow()
    .notNull(),
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
    createdAt: timestamp('created_at', { precision: 3, mode: 'date' })
      .defaultNow()
      .notNull(),
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
