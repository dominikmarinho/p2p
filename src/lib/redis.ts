import { Redis } from 'ioredis';
import type { Environment } from '../config/env.js';
import { logger } from './logger.js';

export function createRedis(env: Environment): Redis {
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    commandTimeout: 3000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3000),
    connectionName: 'highpass-api',
  });
  redis.on('error', (error) => logger.error({ err: error }, 'Erro Redis'));
  return redis;
}

export async function closeRedis(redis: Redis): Promise<void> {
  if (redis.status === 'ready') {
    await redis.quit().catch(() => redis.disconnect());
  } else redis.disconnect();
}
