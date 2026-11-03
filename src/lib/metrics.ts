import client, { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import metricsModule from 'fastify-metrics';
import type { FastifyInstance } from 'fastify';
import type { Environment } from '../config/env.js';
import { equalSecret } from './secrets.js';
import { AppError } from './errors.js';

export function createMetrics() {
  const registry = new Registry();
  const common = { registers: [registry] };
  return {
    registry,
    connections: new Gauge({ ...common, name: 'websocket_active_connections', help: 'WebSockets ativos neste processo' }),
    received: new Counter({ ...common, name: 'websocket_messages_received_total', help: 'Mensagens WS recebidas' }),
    sent: new Counter({ ...common, name: 'websocket_messages_sent_total', help: 'Mensagens WS enviadas' }),
    auth: new Histogram({ ...common, name: 'xui_auth_duration_seconds', help: 'Tempo de validação XUI', labelNames: ['result'], buckets: [.01, .05, .1, .5, 1, 3, 5] }),
  };
}
export type Metrics = ReturnType<typeof createMetrics>;
export function registerMetrics(app: FastifyInstance, env: Environment, metrics: Metrics): void {
  app.register(metricsModule.default, {
    promClient: { ...client, register: metrics.registry },
    endpoint: { url: '/metrics', config: { rateLimit: false, disableMetrics: true }, onRequest: (request, _reply, done) => {
      if (!equalSecret(request.headers.authorization ?? '', `Bearer ${env.METRICS_TOKEN}`)) throw new AppError(401, 'METRICS_AUTH', 'Token de métricas obrigatório');
      done();
    } },
    defaultMetrics: { enabled: true, register: metrics.registry },
    routeMetrics: { enabled: { histogram: true, summary: false }, maxSeries: 500, routeBlacklist: ['/health', '/health/ready', '/metrics'], overrides: { histogram: { registers: [metrics.registry], buckets: [.005, .01, .025, .05, .1, .25, .5, 1, 3, 5] }, summary: { registers: [metrics.registry] } } },
  });
  app.addHook('onClose', (_instance, done) => { metrics.registry.clear(); done(); });
}
