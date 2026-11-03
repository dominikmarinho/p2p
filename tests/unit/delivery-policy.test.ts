import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPolicy } from '../../apps/webplayer/src/p2p/delivery-policy.js';
import type { Playback } from '../../apps/webplayer/src/api.js';
const playback: Playback = { url: '/video.m3u8', trackerPath: '/tracker', swarmId: 'test', expiresAt: 9999999999999, isLive: true, isHls: true, iceServers: [], delivery: { mode: 'p2p-first', seedPath: '/api/iptv/seed/abc', segmentTimeoutMs: 3000, recoveryMs: 5000 } };
let policy: DeliveryPolicy;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T00:00:00Z')); vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'https://p2p.remoto.api.br' } })); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })); });
afterEach(() => { policy?.destroy(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('entrega P2P com contingência e recuperação', () => {
  it('P2P exclusivo nunca permite HTTP, mesmo sem seed ou após timeout', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ state: 'unavailable' }) } as Response);
    const mode = vi.fn(); policy = new DeliveryPolicy({ ...playback, transport: 'p2p', delivery: { ...playback.delivery!, mode: 'p2p-only' } }, mode);
    policy.begin('s1', 0); await vi.advanceTimersByTimeAsync(30000); policy.fallback();
    expect(policy.httpAllowed).toBe(false); expect(mode.mock.calls).toEqual([[false]]);
  });
  it('prioriza P2P e abre HTTP somente após o prazo do segmento', () => { const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); policy.begin('s1', 12); vi.advanceTimersByTime(2999); expect(mode.mock.calls).toEqual([[false]]); vi.advanceTimersByTime(1); expect(mode).toHaveBeenLastCalledWith(true); });
  it('mantém P2P quando o segmento chega dentro do prazo', () => { const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); policy.begin('s1', 12); policy.finish('s1'); vi.advanceTimersByTime(4000); expect(mode.mock.calls).toEqual([[false]]); });
  it('retorna automaticamente à tentativa P2P depois da contingência', () => { const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); policy.fallback(); vi.advanceTimersByTime(5000); expect(mode.mock.calls).toEqual([[false], [true], [false]]); });
  it('recupera imediatamente ao receber segmento P2P e evita reconfigurar por chunk', () => { const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); policy.fallback(); policy.recovered(); policy.recovered(); policy.recovered(); expect(mode.mock.calls).toEqual([[false], [true], [false]]); });
  it('não fecha contingência por prefetch enquanto o segmento solicitado está atrasado', () => { const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); policy.begin('needed', 20); vi.advanceTimersByTime(3000); policy.recovered('prefetch'); expect(mode).toHaveBeenLastCalledWith(true); policy.recovered('needed'); expect(mode).toHaveBeenLastCalledWith(false); });
  it('envia a posição ao seed e libera o lease ao encerrar', async () => { policy = new DeliveryPolicy(playback, vi.fn()); await vi.advanceTimersByTimeAsync(1000); policy.playhead(130); await vi.advanceTimersByTimeAsync(0); expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.body === JSON.stringify({ position: 130 }))).toBe(true); policy.destroy(); expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(true); });
  it('envia a última posição após coalescer eventos dentro de 800ms', async () => { policy = new DeliveryPolicy(playback, vi.fn()); await vi.advanceTimersByTimeAsync(100); policy.playhead(130); await vi.advanceTimersByTimeAsync(750); expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.body === JSON.stringify({ position: 130 }))).toBe(true); });
  it('cancela prazos pendentes ao trocar de fonte', () => { const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); policy.begin('old', 0); policy.reset(); vi.advanceTimersByTime(4000); expect(mode.mock.calls).toEqual([[false]]); });
  it('mantém a tentativa P2P enquanto o seed aquece até o prazo do segmento', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ state: 'warming' }) } as Response);
    const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); policy.begin('first', 0);
    await vi.advanceTimersByTimeAsync(2999); expect(mode.mock.calls).toEqual([[false]]); await vi.advanceTimersByTimeAsync(1); expect(mode).toHaveBeenLastCalledWith(true);
  });
  it('abre HTTP se o seed confirma indisponibilidade e retoma P2P ao ficar pronto', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ state: 'unavailable' }) } as Response);
    const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); await vi.advanceTimersByTimeAsync(1); expect(mode).toHaveBeenLastCalledWith(true);
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ state: 'ready' }) } as Response);
    policy.playhead(10); await vi.advanceTimersByTimeAsync(1000); expect(mode).toHaveBeenLastCalledWith(false);
  });

  it('mantém P2P ativo quando a resposta do seed está atrasada mas há entrega real de peer', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ state: 'ready' }) } as Response);
    const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); await vi.advanceTimersByTimeAsync(1); policy.recovered('first');
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ state: 'warming' }) } as Response);
    policy.playhead(10); await vi.advanceTimersByTimeAsync(1000); expect(mode.mock.calls).toEqual([[false]]);
  });

  it('não desativa um peer que entrega vídeo quando o seed está indisponível', async () => {
    const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); policy.recovered('previous');
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ state: 'unavailable' }) } as Response);
    policy.begin('next', 11); await vi.advanceTimersByTimeAsync(2999); expect(mode.mock.calls).toEqual([[false]]);
    await vi.advanceTimersByTimeAsync(1); expect(mode).toHaveBeenLastCalledWith(true);
  });

  it('devolve a tentativa ao peer quando o HTTP falha, sem esperar janela de recuperação', () => { const mode = vi.fn(); policy = new DeliveryPolicy(playback, mode); policy.fallback(); policy.retryP2P(); expect(mode.mock.calls).toEqual([[false], [true], [false]]); });

  it('fecha o lease em pagehide mesmo sem desmontar React, sem duplicar DELETE ao destruir', async () => {
    policy = new DeliveryPolicy(playback, vi.fn()); await vi.advanceTimersByTimeAsync(1);
    window.dispatchEvent(new Event('pagehide')); policy.destroy(); window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(20000);
    const deletes = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'DELETE');
    expect(deletes).toHaveLength(1); expect(deletes[0]?.[1]?.keepalive).toBe(true);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
  it('cancela o heartbeat em voo antes de liberar o lease e retoma ao voltar do BFCache', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_url, options) => {
      if (options?.method === 'DELETE') return Promise.resolve({ ok: true } as Response);
      signal = options?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    });
    policy = new DeliveryPolicy(playback, vi.fn()); expect(signal?.aborted).toBe(false);
    window.dispatchEvent(new Event('pagehide')); expect(signal?.aborted).toBe(true); await vi.advanceTimersByTimeAsync(0);
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response); window.dispatchEvent(new Event('pageshow')); await vi.advanceTimersByTimeAsync(5001);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(3);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1);
    policy.destroy(); expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(2);
  });
  it('mantém a renovação ao esconder uma aba que continua reproduzindo', async () => {
    policy = new DeliveryPolicy(playback, vi.fn()); window.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10001);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(3);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(0);
  });

});
