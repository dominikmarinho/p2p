import { describe, expect, it } from 'vitest';
import { xuiTransportUrl } from '../../src/lib/xui-transport.js';
const env = { XUI_BASE_URL: 'http://origin.example:8080', XUI_ALLOW_HTTP: true, XUI_PRESERVE_HTTP: true };
describe('transporte explícito da origem XUI', () => {
  it('preserva HTTP e a porta configurada no redirect HTTPS da mesma origem', () => { expect(xuiTransportUrl(new URL('https://origin.example/auth/opaque?x=1'), env).href).toBe('http://origin.example:8080/auth/opaque?x=1'); });
  it('mantém HTTPS quando a origem foi configurada com HTTPS', () => { expect(xuiTransportUrl(new URL('https://origin.example/auth'), { ...env, XUI_BASE_URL: 'https://origin.example' }).protocol).toBe('https:'); });
  it('mantém HTTPS de outros hosts e portas explícitas', () => { for (const url of ['https://other.example/auth', 'https://origin.example:8443/auth']) expect(xuiTransportUrl(new URL(url), env).href).toBe(url); });
  it('exige permissão HTTP e a política explícita', () => { for (const config of [{ ...env, XUI_ALLOW_HTTP: false }, { ...env, XUI_PRESERVE_HTTP: false }]) expect(xuiTransportUrl(new URL('https://origin.example/auth'), config).protocol).toBe('https:'); });
});
