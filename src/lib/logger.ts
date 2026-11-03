import { pino } from 'pino';
import type { FastifyBaseLogger } from 'fastify';

export const logger: FastifyBaseLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.refreshToken', '*.accessToken', '*.ticket'],
    censor: '[REDACTED]',
  },
  serializers: {
    req: (request: { method: string; url: string }) => ({ method: request.method, url: request.url.split('?')[0]?.replace(/\/api\/iptv\/(media|tracker|vod)\/[^/]+(?:\/[^/]+)?/, '/api/iptv/$1/[redacted]') }),
  },
});
