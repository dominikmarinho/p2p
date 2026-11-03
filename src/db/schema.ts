import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  familyId: uuid('family_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('refresh_tokens_family_idx').on(table.familyId), index('refresh_tokens_expiry_idx').on(table.expiresAt)]);

export const notes = pgTable('notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('notes_owner_id_idx').on(table.ownerId, table.id)]);

export const xuiServers = pgTable('xui_servers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  encryptedApiToken: text('encrypted_api_token'),
  encryptedAdminAccessCode: text('encrypted_admin_access_code'),
  encryptedAdminApiKey: text('encrypted_admin_api_key'),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const streamRoutes = pgTable('stream_routes', {
  channel: text('channel').primaryKey(),
  streamId: integer('stream_id').notNull(),
  serverId: uuid('server_id').notNull().references(() => xuiServers.id, { onDelete: 'restrict' }),
  fallbackServerIds: jsonb('fallback_server_ids').$type<string[]>().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
});
export const p2pConfig = pgTable('p2p_config', {
  id: integer('id').primaryKey().default(1),
  bufferSeconds: integer('buffer_seconds').notNull().default(15),
  maxUploadKbps: integer('max_upload_kbps').notNull().default(2048),
  maxConnectionsPerNode: integer('max_connections_per_node').notNull().default(4),
  maxPeersPerChannel: integer('max_peers_per_channel').notNull().default(256),
});
export const adminKeys = pgTable('admin_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const adminWhitelist = pgTable('admin_whitelist', {
  id: uuid('id').defaultRandom().primaryKey(),
  cidr: text('cidr').notNull().unique(),
});
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  ip: text('ip').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('audit_logs_created_at_idx').on(table.createdAt)]);

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  authVersion: integer('auth_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
