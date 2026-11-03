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
    reportedDown: new Counter({ ...common, name: 'player_reported_download_bytes_total', help: 'Payload informado pelos players, não auditado para cobrança', labelNames: ['transport', 'client'] }),
    reportedUp: new Counter({ ...common, name: 'player_reported_upload_bytes_total', help: 'Upload informado pelos players', labelNames: ['client'] }),
    playbackErrors: new Counter({ ...common, name: 'player_reported_errors_total', help: 'Erros informados pelos players', labelNames: ['client', 'code'] }),
    upstream: new Histogram({ ...common, name: 'xui_upstream_header_duration_seconds', help: 'Tempo até os headers da origem, incluindo redirects; não mede duração de vídeo', labelNames: ['kind', 'result'], buckets: [.005, .01, .025, .05, .1, .25, .5, 1, 3, 10] }),
    upstreamErrors: new Counter({ ...common, name: 'xui_upstream_errors_total', help: 'Falhas de rede ou HTTP da origem', labelNames: ['kind', 'code'] }),
    connections: new Gauge({ ...common, name: 'websocket_active_connections', help: 'WebSockets ativos neste processo' }),
    received: new Counter({ ...common, name: 'websocket_messages_received_total', help: 'Mensagens WS recebidas' }),
    sent: new Counter({ ...common, name: 'websocket_messages_sent_total', help: 'Mensagens WS enviadas' }),
    auth: new Histogram({ ...common, name: 'xui_auth_duration_seconds', help: 'Tempo de validação XUI', labelNames: ['result'], buckets: [.01, .05, .1, .5, 1, 3, 5] }),
    seedActive: new Gauge({ ...common, name: 'p2p_seed_active_streams', help: 'Conteúdos com seed alocado' }),
    seedReady: new Gauge({ ...common, name: 'p2p_seed_ready_streams', help: 'Seeds com segmentos recentes disponíveis' }),
    seedViewers: new Gauge({ ...common, name: 'p2p_seed_viewers', help: 'Players com lease ativo no seed' }),
    seedOrigin: new Counter({ ...common, name: 'p2p_seed_origin_bytes_total', help: 'Payload HTTP recebido pelos seeds' }),
    seedUpload: new Counter({ ...common, name: 'p2p_seed_uploaded_bytes_total', help: 'Payload WebRTC enviado pelos seeds' }),
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
