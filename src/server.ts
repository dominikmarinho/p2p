import 'dotenv/config';
import { buildApp } from './app.js';
import { loadEnvironment } from './config/env.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  const env = loadEnvironment();
  const app = buildApp(env);
  let shutdownPromise: Promise<void> | undefined;
  let failed = false;

  const shutdown = (reason: string, error?: unknown): Promise<void> => {
    if (error !== undefined) { failed = true; logger.fatal({ err: error }, reason); }
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      logger.info({ reason }, 'Encerrando servidor');
      const timeout = setTimeout(() => { logger.fatal('Prazo de shutdown excedido'); process.exit(1); }, env.SHUTDOWN_TIMEOUT_MS);
      timeout.unref();
      try { await app.close(); }
      catch (closeError) { failed = true; logger.error({ err: closeError }, 'Erro durante shutdown'); }
      finally { clearTimeout(timeout); process.exitCode = failed ? 1 : 0; }
    })();
    return shutdownPromise;
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('unhandledRejection', (error) => { void shutdown('Unhandled rejection', error); });
  process.on('uncaughtException', (error) => { void shutdown('Uncaught exception', error); });
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    if (typeof process.send === 'function') process.send('ready');
  } catch (error) { await shutdown('Falha ao inicializar', error); }
}

main().catch((error: unknown) => { logger.fatal({ err: error }, 'Configuração inválida'); process.exitCode = 1; });
