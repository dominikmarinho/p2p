import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomFillSync } from 'node:crypto';
import { telemetryId } from '../../apps/webplayer/src/p2p/telemetry.js';
afterEach(() => vi.unstubAllGlobals());
describe('identificação de telemetria no WebView Android', () => {
  it('funciona sem randomUUID no build HTTP local e gera UUID v4 distintos', () => {
    vi.stubGlobal('crypto', { getRandomValues: (buffer: Uint8Array) => randomFillSync(buffer) });
    const first = telemetryId(); const second = telemetryId();
    expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/); expect(first).not.toBe(second);
  });
});
