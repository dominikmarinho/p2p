import { eq, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { streamRoutes, xuiServers } from '../../db/schema.js';
import type { Environment } from '../../config/env.js';
import { encrypt } from '../../lib/secrets.js';
import { AppError } from '../../lib/errors.js';
import type { XuiServerInput } from './admin.dto.js';

export class XuiServersService {
  constructor(private readonly db: Database, private readonly env: Environment) {}
  validateUrl(value: string): URL {
    const url = this.validateRequestUrl(value);
    if (url.search || url.hash) throw new AppError(400, 'XUI_URL_NOT_ALLOWED', 'URL base deve omitir query string e fragmento');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  }
  validateRequestUrl(value: string): URL {
    const url = new URL(value);
    const allowed = [new URL(this.env.XUI_BASE_URL).host, ...this.env.XUI_ALLOWED_HOSTS.split(',').map((host) => host.trim())];
    if (!allowed.includes(url.host) || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && this.env.XUI_ALLOW_HTTP))) {
      throw new AppError(400, 'XUI_URL_NOT_ALLOWED', 'URL XUI fora da allowlist ou protocolo não permitido');
    }
    return url;
  }
  async list() {
    const rows = await this.db.select().from(xuiServers).orderBy(xuiServers.name).limit(200);
    return rows.map(({ encryptedApiToken, ...row }) => ({ ...row, hasApiToken: Boolean(encryptedApiToken) }));
  }
  async save(input: XuiServerInput, id?: string) {
    const values = {
      name: input.name, baseUrl: this.validateUrl(input.baseUrl).href, enabled: input.enabled, updatedAt: new Date(),
      ...(input.apiToken !== undefined ? { encryptedApiToken: input.apiToken ? encrypt(input.apiToken, this.env.CONFIG_ENCRYPTION_KEY) : null } : {}),
    };
    const rows = id ? await this.db.update(xuiServers).set(values).where(eq(xuiServers.id, id)).returning({ id: xuiServers.id })
      : await this.db.insert(xuiServers).values(values).returning({ id: xuiServers.id });
    const row = rows[0];
    if (!row) throw new AppError(404, 'XUI_NOT_FOUND', 'Servidor não encontrado');
    return row;
  }
  async delete(id: string) {
    await this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(724992019)`);
      const [route] = await transaction.select({ channel: streamRoutes.channel }).from(streamRoutes)
        .where(or(eq(streamRoutes.serverId, id), sql`${streamRoutes.fallbackServerIds} @> ${JSON.stringify([id])}::jsonb`)).limit(1);
      if (route) throw new AppError(409, 'XUI_IN_USE', 'Remova o servidor das regras antes de excluir');
      const [row] = await transaction.delete(xuiServers).where(eq(xuiServers.id, id)).returning({ id: xuiServers.id });
      if (!row) throw new AppError(404, 'XUI_NOT_FOUND', 'Servidor não encontrado');
    });
  }
}
