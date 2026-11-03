import type { Environment } from '../config/env.js';

/** Mantém o transporte HTTP explicitamente permitido para a origem XUI cadastrada. */
export function xuiTransportUrl(input: URL, env: Pick<Environment, 'XUI_BASE_URL' | 'XUI_ALLOW_HTTP' | 'XUI_PRESERVE_HTTP'>): URL {
  const url = new URL(input.href); const origin = new URL(env.XUI_BASE_URL);
  if (env.XUI_PRESERVE_HTTP && env.XUI_ALLOW_HTTP && origin.protocol === 'http:' && url.protocol === 'https:' && url.hostname === origin.hostname && !url.port) {
    url.protocol = 'http:'; url.port = origin.port;
  }
  return url;
}
