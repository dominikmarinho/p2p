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
      now += 36000;
      expect(await seeds.prepare(app, token, 'second')).toMatchObject({ state: 'warming' });
      expect(stopSeed).toHaveBeenCalledWith('seed:first'); expect(seeds.snapshot().streams[0]?.swarm).toBe('second');
      await expect(seeds.prepare(app, 'wrong-token', 'third')).rejects.toMatchObject({ code: 'MEDIA_OWNER' });
    } finally { await seeds.close(); await app.close(); clock.mockRestore(); }
  });
});
