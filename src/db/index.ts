import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Environment } from '../config/env.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema.js';

export function createDatabase(env: Environment) {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6000,
    application_name: 'highpass-api',
    keepAlive: true,
  });
  pool.on('error', (error) => logger.error({ err: error }, 'Erro em conexão ociosa PostgreSQL'));
  return { pool, db: drizzle(pool, { schema }) };
}

export type Database = ReturnType<typeof createDatabase>['db'];
