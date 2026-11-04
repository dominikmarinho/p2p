import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { SeedManager } from '../../src/modules/iptv/seed-manager.js';
import { digest } from '../../src/lib/secrets.js';
import type { IptvService } from '../../src/modules/iptv/iptv.service.js';
import type { RokuRelay } from '../../src/modules/iptv/roku-relay.js';
import type { Metrics } from '../../src/lib/metrics.js';

describe('aquecimento antecipado e capacidade dos seeds', () => {
  it('começa antes do primeiro heartbeat e recupera a vaga de espectador desconectado', async () => {
    let now = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const token = 'a'.repeat(64);
    const service = { env: { P2P_SEED_ENABLED: true, P2P_SEED_MAX_STREAMS: 1 }, grant: (id: string) => Promise.resolve({ sessionHash: digest(token), swarmId: id, kind: 'live', id }) } as unknown as IptvService;
    const stopSeed = vi.fn(() => Promise.resolve()); const startSeed = vi.fn(() => Promise.resolve(true));
    const relay = { stopSeed, startSeed, seedStatus: () => Promise.resolve({ ready: true, positions: [0] }), stats: () => undefined } as unknown as RokuRelay;
    const counter = { inc: vi.fn(), set: vi.fn() };
    const metrics = { seedOrigin: counter, seedUpload: counter, seedActive: counter, seedReady: counter, seedViewers: counter } as unknown as Metrics;
    const app = Fastify(); await app.listen({ host: '127.0.0.1', port: 0 }); const seeds = new SeedManager(service, relay, metrics);
    try {
      expect(await seeds.prepare(app, token, 'first')).toMatchObject({ state: 'warming' });
      await vi.waitFor(() => expect(startSeed).toHaveBeenCalledWith('seed:first', 'first', token, expect.stringContaining('127.0.0.1')));
      await vi.waitFor(() => expect(seeds.snapshot().ready).toBe(1));
      expect(await seeds.prepare(app, token, 'second')).toMatchObject({ state: 'unavailable', reason: 'capacity' });
      now += 16000;
      expect(await seeds.prepare(app, token, 'second')).toMatchObject({ state: 'warming' });
      expect(stopSeed).toHaveBeenCalledWith('seed:first'); expect(seeds.snapshot().streams[0]?.swarm).toBe('second');
      await expect(seeds.prepare(app, 'wrong-token', 'third')).rejects.toMatchObject({ code: 'MEDIA_OWNER' });
    } finally { await seeds.close(); await app.close(); clock.mockRestore(); }
  });
  it('preserva outros espectadores e encerra o worker assim que o último sai', async () => {
    const token = 'a'.repeat(64); const stopSeed = vi.fn(() => Promise.resolve()); const startSeed = vi.fn(() => Promise.resolve(true));
    const service = { env: { P2P_SEED_ENABLED: true, P2P_SEED_MAX_STREAMS: 1 }, grant: (id: string) => Promise.resolve({ sessionHash: digest(token), swarmId: 'shared', kind: 'live', id }) } as unknown as IptvService;
    const relay = { stopSeed, startSeed, seedStatus: () => Promise.resolve({ ready: true, positions: [0] }), stats: () => undefined } as unknown as RokuRelay;
    const counter = { inc: vi.fn(), set: vi.fn() }; const metrics = { seedOrigin: counter, seedUpload: counter, seedActive: counter, seedReady: counter, seedViewers: counter } as unknown as Metrics;
    const app = Fastify(); await app.listen({ host: '127.0.0.1', port: 0 }); const seeds = new SeedManager(service, relay, metrics);
    try {
      await seeds.prepare(app, token, 'owner'); await seeds.prepare(app, token, 'second');
      await vi.waitFor(() => expect(seeds.snapshot().ready).toBe(1));
      await seeds.detach('owner'); expect(seeds.snapshot().streams[0]?.viewers).toBe(1); expect(stopSeed).not.toHaveBeenCalled();
      await seeds.detach('second'); expect(seeds.snapshot().active).toBe(0); expect(stopSeed).toHaveBeenCalledExactlyOnceWith('seed:shared');
      expect(await seeds.prepare(app, token, 'second')).toMatchObject({ state: 'warming', reason: 'releasing' });
      expect(seeds.snapshot().active).toBe(0);
    } finally { await seeds.close(); await app.close(); }
  });
  it('expira o lease de um player que desapareceu sem DELETE', async () => {
    let now = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const token = 'b'.repeat(64); const stopSeed = vi.fn(() => Promise.resolve());
    const service = { env: { P2P_SEED_ENABLED: true, P2P_SEED_MAX_STREAMS: 1 }, grant: (id: string) => Promise.resolve({ sessionHash: digest(token), swarmId: id, kind: 'live', id }) } as unknown as IptvService;
    const relay = { stopSeed, startSeed: () => Promise.resolve(true), seedStatus: () => Promise.resolve({ ready: true, positions: [0] }), stats: () => undefined } as unknown as RokuRelay;
    const counter = { inc: vi.fn(), set: vi.fn() }; const metrics = { seedOrigin: counter, seedUpload: counter, seedActive: counter, seedReady: counter, seedViewers: counter } as unknown as Metrics;
    const app = Fastify(); await app.listen({ host: '127.0.0.1', port: 0 }); const seeds = new SeedManager(service, relay, metrics);
    try {
      await seeds.prepare(app, token, 'crashed'); await vi.waitFor(() => expect(seeds.snapshot().ready).toBe(1)); now += 16000;
      await vi.waitFor(() => expect(seeds.snapshot().active).toBe(0), { timeout: 2000 });
      expect(stopSeed).toHaveBeenCalledWith('seed:crashed');
    } finally { await seeds.close(); await app.close(); clock.mockRestore(); }
  });

  it('descarta heartbeat antigo que terminou de autenticar depois do encerramento', async () => {
    let now = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const token = 'c'.repeat(64); let complete: (value: unknown) => void = () => undefined;
    const grant = { sessionHash: digest(token), swarmId: 'late', kind: 'live', id: 'late' };
    const service = { env: { P2P_SEED_ENABLED: true, P2P_SEED_MAX_STREAMS: 1 }, grant: () => new Promise((resolve) => { complete = resolve; }) } as unknown as IptvService;
    const relay = { stopSeed: () => Promise.resolve() } as unknown as RokuRelay;
    const app = Fastify(); await app.listen({ host: '127.0.0.1', port: 0 }); const seeds = new SeedManager(service, relay, {} as Metrics);
    try {
      const pending = seeds.prepare(app, token, 'late'); await seeds.detach('late'); now += 6000; complete(grant);
      expect(await pending).toMatchObject({ state: 'warming', reason: 'releasing' }); expect(seeds.snapshot().active).toBe(0);
    } finally { await seeds.close(); await app.close(); clock.mockRestore(); }
  });

  it('mantém réplica pronta enquanto reinicia apenas o alimentador e fecha os dois ao sair', async () => {
    const token = 'd'.repeat(64); const stopSeed = vi.fn(() => Promise.resolve()); const startReplica = vi.fn(() => Promise.resolve(true));
    const service = { env: { P2P_SEED_ENABLED: true, P2P_SEED_MAX_STREAMS: 1, P2P_SEED_WORKERS: 2 }, grant: () => Promise.resolve({ sessionHash: digest(token), swarmId: 'redundant', kind: 'live', id: '1' }) } as unknown as IptvService;
    const relay = { stopSeed, startReplica, startSeed: () => Promise.resolve(true), seedStatus: () => Promise.resolve({ ready: true, positions: [0] }), stats: () => ({ httpDownloaded: 0, p2pUploaded: 0 }) } as unknown as RokuRelay;
    const counter = { inc: vi.fn(), set: vi.fn() }; const metrics = { seedOrigin: counter, seedUpload: counter, seedActive: counter, seedReady: counter, seedViewers: counter } as unknown as Metrics;
    const app = Fastify(); await app.listen({ host: '127.0.0.1', port: 0 }); const seeds = new SeedManager(service, relay, metrics);
    try {
      await seeds.prepare(app, token, 'viewer'); await vi.waitFor(() => expect(seeds.snapshot().readyWorkers).toBe(2));
      expect(startReplica).toHaveBeenCalledWith('seed:redundant:replica:1', 'viewer', token, expect.any(String));
      await seeds.restart('redundant', 5000); expect(stopSeed).toHaveBeenCalledExactlyOnceWith('seed:redundant'); expect(seeds.snapshot().ready).toBe(1);
      await seeds.detach('viewer'); expect(stopSeed).toHaveBeenCalledWith('seed:redundant:replica:1'); expect(seeds.snapshot().active).toBe(0);
    } finally { await seeds.close(); await app.close(); }
  });

});
