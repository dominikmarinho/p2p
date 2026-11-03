import 'dotenv/config';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { adminUsers } from './schema.js';
import { hashPassword } from '../lib/password.js';
import { logger } from '../lib/logger.js';

async function runMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obrigatória para migrations');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
    application_name: 'highpass-migrator',
  });
  pool.on('error', (error) => logger.error({ err: error }, 'Erro na conexão do migrator'));
  let interrupted = false;
  const interrupt = () => { interrupted = true; process.exitCode = 1; };
  process.once('SIGTERM', interrupt);
  process.once('SIGINT', interrupt);
  // Se um DDL não concluir dentro do prazo, sair fecha a sessão e reverte sua transação.
  const deadline = setTimeout(() => { logger.fatal('Timeout do migrator'); process.exit(1); }, 180000);
  const client = await pool.connect().catch(async (error: unknown) => { await pool.end(); throw error; });
  try {
    await client.query("SET lock_timeout = '60s'");
    await client.query('SELECT pg_advisory_lock(724992018)');
    if (interrupted) throw new Error('Migration interrompida antes de iniciar');
    await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), 'drizzle') });
    await drizzle(client).insert(adminUsers).values({ username: 'admin', passwordHash: await hashPassword(process.env.ADMIN_INITIAL_PASSWORD ?? 'admin'), mustChangePassword: !process.env.ADMIN_INITIAL_PASSWORD }).onConflictDoNothing();
    logger.info('Migrations aplicadas e administrador provisionado');
  } finally {
    await client.query('SELECT pg_advisory_unlock(724992018)').catch(() => undefined);
    client.release();
    await pool.end();
    clearTimeout(deadline);
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGINT', interrupt);
  }
}

runMigrations().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Falha ao aplicar migrations');
  process.exit(1);
});
