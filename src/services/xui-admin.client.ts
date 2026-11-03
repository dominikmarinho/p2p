import { z } from 'zod';
import { AppError } from '../lib/errors.js';

const serverDto = z.object({ id: z.union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]*$/)]) });
const resultDto = z.union([
  z.array(serverDto.extend({ server_name: z.string() })),
  z.object({ status: z.literal('STATUS_SUCCESS'), data: z.union([z.array(serverDto), z.record(z.string(), serverDto)]) }),
]);

/** Consulta administrativa somente de leitura; nunca encaminha credenciais ao player. */
export async function checkXuiAdminConnection(base: URL, accessCode: string, apiKey: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accessCode)) throw new AppError(400, 'XUI_ADMIN_ACCESS_CODE', 'Access Code Admin API inválido');
  const url = new URL(`${encodeURIComponent(accessCode)}/`, base);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('action', 'get_servers');
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('Resposta administrativa recusada');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1024 * 1024) throw new Error('Resposta administrativa acima do limite');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const result = resultDto.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
    if (!result.success) throw new Error('Resposta administrativa inválida');
    const servers = Array.isArray(result.data) ? result.data : result.data.data;
    return { ok: true, action: 'get_servers', serverCount: Object.keys(servers).length, checkedAt: new Date().toISOString() };
  } catch {
    // O upstream pode incluir API Key/URL no erro. Retorna apenas uma mensagem própria.
    throw new AppError(502, 'XUI_ADMIN_CONNECTION', 'Não foi possível validar a Admin API do XUI ONE. Verifique URL/porta, Access Code do tipo Admin API, API Key, permissões e liberação do IP deste servidor no XUI.');
  }
}
