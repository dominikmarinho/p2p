import { z } from 'zod';

const integer = (fallback: number, max: number) => z.coerce.number().int().positive().max(max).default(fallback);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: integer(3000, 65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  DB_POOL_MAX: integer(10, 100),
  REDIS_HOST: z.string().min(1).default('127.0.0.1'),
  REDIS_PORT: integer(6379, 65535),
  REDIS_PASSWORD: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('highpass'),
  JWT_AUDIENCE: z.string().default('highpass-api'),
  ACCESS_TOKEN_TTL_SECONDS: integer(900, 3600),
  REFRESH_TOKEN_TTL_SECONDS: integer(2592000, 7776000),
  RATE_LIMIT_MAX: integer(100, 100000),
  RATE_LIMIT_NAMESPACE: z.string().min(1).max(128).default('highpass:rate:'),
  ADMIN_BOOTSTRAP_KEY: z.string().min(32).default('local-admin-key-change-before-production'),
  CONFIG_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/).default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  XUI_ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1'),
  XUI_ALLOW_HTTP: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  METRICS_TOKEN: z.string().min(32).default('local-metrics-token-change-before-production'),
  CHROMIUM_PATH: z.string().default(''),
  P2P_RELAY_MAX_SESSIONS: integer(4, 32),
  VOD_CACHE_DIR: z.string().default(''),
  XUI_BASE_URL: z.url().default('http://xuione.remoto.api.br'),
  PUBLIC_ENGINE_URL: z.url().default('https://p2p.remoto.api.br'),
  CLIENT_SESSION_TTL_SECONDS: integer(86400, 86400),
  RTC_ICE_SERVERS: z.string().default('[{"urls":"stun:stun.l.google.com:19302"}]').transform((value, context) => {
    try { return z.array(z.object({ urls: z.union([z.string(), z.array(z.string())]), username: z.string().optional(), credential: z.string().optional() })).max(8).parse(JSON.parse(value) as unknown); }
    catch { context.addIssue({ code: 'custom', message: 'RTC_ICE_SERVERS deve ser um array JSON válido' }); return z.NEVER; }
  }),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  SHUTDOWN_TIMEOUT_MS: integer(20000, 120000),
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('local-')) {
    context.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'Use um segredo aleatório em produção' });
  }
  if (env.NODE_ENV === 'production' && (env.ADMIN_BOOTSTRAP_KEY.startsWith('local-') || env.METRICS_TOKEN.startsWith('local-') || env.CONFIG_ENCRYPTION_KEY.startsWith('01234567'))) {
    context.addIssue({ code: 'custom', message: 'Configure chaves administrativas, de métricas e criptografia aleatórias em produção' });
  }
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Ambiente inválido: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return result.data;
}
