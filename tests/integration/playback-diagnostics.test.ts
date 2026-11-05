import { Redis } from 'ioredis';
import { digest } from '../../src/lib/secrets.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { xuiFixture } from '../helpers/xui-fixture.js';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';
const source = xuiFixture(); let app: ReturnType<typeof buildApp>; let headers: { authorization: string }; let other: { authorization: string }; let path: string;
const admin = { 'x-api-key': 'local-admin-key-change-before-production' }; const client = randomUUID();
const payload = { time: 10, ready: 4, paused: false, rate: 1, buffered: [[0, 30]], width: 320, height: 180, frames: 120, dropped: 0, peers: 2, http: 0, p2p: 100000, upload: 0, latency: 44, targetLatency: 44, waiting: 1, events: [{ at: 500, code: 'waiting' }], frameStatus: 'no-video' };
beforeAll(async () => {
  const origin = await source.listen({ host: '127.0.0.1', port: 0 }); app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', RATE_LIMIT_MAX: '1000', RATE_LIMIT_NAMESPACE: `diagnostic:${randomUUID()}:` })); await app.ready();
  const login = async (username: string) => { const response = await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username, password: 'secret-line' } }); return { authorization: `Bearer ${response.json<{ token: string }>().token}` }; };
  headers = await login('alice'); other = await login('bob');
  const d = (await app.inject({ method: 'POST', url: '/api/iptv/playback', headers, payload: { kind: 'live', id: '1', transport: 'http' } })).json<{ telemetryPath: string }>(); path = d.telemetryPath.replace('/telemetry/', '/diagnostics/') + '/' + client;
});
afterAll(async () => { await app.close(); await source.close(); });
it('exige ativação, proprietário correto e autenticação administrativa para ler', async () => {
  expect((await app.inject({ method: 'POST', url: path, headers, payload })).statusCode).toBe(410);
  expect((await app.inject({ method: 'POST', url: path + '/start', headers: other })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: path + '/start', headers })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: path, headers: other, payload })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: path, headers, payload })).statusCode).toBe(204);
  expect((await app.inject('/api/admin/playback-diagnostics')).statusCode).toBe(401);
  const response = await app.inject({ url: '/api/admin/playback-diagnostics', headers: admin }); expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json<unknown[]>()).toEqual(expect.arrayContaining([expect.objectContaining({ time: 10, content: '1', peers: 2 })]));
});
it('limita as imagens e remove a amostra ao parar, recusando uploads atrasados', async () => {
  expect((await app.inject({ method: 'POST', url: path, headers, payload: { ...payload, frame: 'data:image/jpeg;base64,YmFk', frameStatus: 'captured' } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url: path, headers, payload: { ...payload, frame: 'data:image/jpeg;base64,' + 'A'.repeat(65000) } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'DELETE', url: path, headers: other })).statusCode).toBe(401);
  expect((await app.inject({ method: 'DELETE', url: path, headers })).statusCode).toBe(204);
  expect((await app.inject({ method: 'POST', url: path, headers, payload })).statusCode).toBe(410);
  const data = (await app.inject({ url: '/api/admin/playback-diagnostics', headers: admin })).json<{ content: string }[]>(); expect(data.filter((row) => row.content === '1')).toEqual([]);
});

it('guarda somente a última amostra cifrada e usa expiração curta no Redis', async () => {
  const id = randomUUID(); const target = path.slice(0, path.lastIndexOf('/') + 1) + id;
  expect((await app.inject({ method: 'POST', url: target + '/start', headers })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: target, headers, payload })).statusCode).toBe(204);
  const env = loadEnvironment(process.env); const redis = new Redis({ host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD, lazyConnect: true });
  try {
    await redis.connect(); const grant = target.split('/diagnostics/')[1]!.split('/')[0]!; const key = 'highpass:diagnostic:data:' + digest(`${grant}:${id}`);
    const raw = await redis.get(key); expect(raw).not.toContain('buffered'); expect(raw).not.toContain('no-video'); expect(raw?.split('.')).toHaveLength(3);
    expect(await redis.ttl(key)).toBeGreaterThan(0); expect(await redis.ttl(key)).toBeLessThanOrEqual(60);
    await app.inject({ method: 'POST', url: target, headers, payload: { ...payload, time: 25 } });
    expect((await redis.get(key))).not.toBe(raw); expect(await redis.type(key)).toBe('string');
    await app.inject({ method: 'DELETE', url: target, headers }); expect(await redis.exists(key)).toBe(0);
  } finally { redis.disconnect(); }
});

it('inicia antes do grant, isola a sessão de login e aceita somente metadados de abertura', async () => {
  const target = '/api/iptv/diagnostics/startup/' + randomUUID();
  const data = { ...payload, frameStatus: 'disabled', startup: { attempt: randomUUID(), clickedAt: new Date().toISOString(), kind: 'live', content: '1', elapsedMs: 1800, marks: { authorization: 1000, firstFrame: 1700 }, frameMethod: 'video-frame-callback' } };
  expect((await app.inject({ method: 'POST', url: target + '/start' })).statusCode).toBe(401);
  const activation = await app.inject({ method: 'POST', url: target + '/start', headers }); expect(activation.statusCode).toBe(200); const code = activation.json<{ code: string }>().code;
  expect((await app.inject({ method: 'POST', url: target, headers, payload: { ...payload, frameStatus: 'disabled' } })).statusCode).toBe(204);
  expect((await app.inject({ method: 'POST', url: target, headers, payload: data })).statusCode).toBe(204);
  expect((await app.inject({ method: 'POST', url: target, headers: other, payload: data })).statusCode).toBe(410);
  await app.inject({ method: 'DELETE', url: target, headers: other });
  const rows = (await app.inject({ url: '/api/admin/playback-diagnostics', headers: admin })).json<{ code: string; startup: { marks: { firstFrame: number } } }[]>();
  expect(rows.find((row) => row.code === code)?.startup.marks.firstFrame).toBe(1700);
  const history = Array.from({ length: 9 }, () => ({ ...data.startup, attempt: randomUUID() }));
  const measured = { ...data, history, startup: { ...data.startup, traffic: { httpBytes: 0, p2pBytes: 1000, uploadBytes: 500, peers: 2, downloadBps: 2000, uploadBps: 100, paths: { direct: 1, relay: 1, unknown: 0 } }, firstSegment: { bytes: 1000, durationSeconds: 4, loadMs: 1200, transferMs: 1000, averageBps: 1000, source: 'p2p' } } };
  expect((await app.inject({ method: 'POST', url: target, headers, payload: measured })).statusCode).toBe(204);
  const saved = (await app.inject({ url: '/api/admin/playback-diagnostics', headers: admin })).json<{ code: string; history?: unknown[] }[]>(); expect(saved.find((row) => row.code === code)?.history).toHaveLength(9);
  expect((await app.inject({ method: 'POST', url: target, headers, payload: { ...measured, history: [...history, data.startup] } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url: target, headers, payload: { ...measured, history: [{ ...data.startup, frame: 'private-image' }] } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url: target, headers, payload: { ...data, frame: 'data:image/jpeg;base64,/9j/' } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'DELETE', url: target, headers })).statusCode).toBe(204);
  expect((await app.inject({ method: 'POST', url: target, headers, payload: data })).statusCode).toBe(410);
});
