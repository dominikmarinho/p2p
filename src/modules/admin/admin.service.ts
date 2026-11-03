import type { AdminAuthService } from './admin-auth.service.js';
import { randomBytes } from 'node:crypto';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../../db/index.js';
import { adminKeys, adminWhitelist, auditLogs, p2pConfig, streamRoutes, xuiServers } from '../../db/schema.js';
import type { Environment } from '../../config/env.js';
import { digest, equalSecret } from '../../lib/secrets.js';
import { AppError } from '../../lib/errors.js';
import { matchesIp, type EngineConfig, type routeDto } from './admin.dto.js';
import type { z } from 'zod';

export class AdminService {
  constructor(private readonly db: Database, private readonly env: Environment, private readonly auth: AdminAuthService) {}
  async authenticate(request: FastifyRequest): Promise<string> {
    if (request.headers.cookie?.includes('HP_ADMIN=')) {
      const user = await this.auth.user(request);
      if (user.mustChangePassword && !['/api/admin/me', '/api/admin/change-password', '/api/admin/logout'].includes(request.url.split('?')[0] ?? '')) throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Altere a senha inicial no perfil');
      return user.id;
    }
    const secret = request.headers['x-api-key'];
    if (typeof secret !== 'string') throw new AppError(401, 'ADMIN_AUTH', 'Chave administrativa obrigatória');
    if (equalSecret(secret, this.env.ADMIN_BOOTSTRAP_KEY)) return 'bootstrap';
    const [key] = await this.db.select().from(adminKeys).where(eq(adminKeys.keyHash, digest(secret))).limit(1);
    if (!key) throw new AppError(401, 'ADMIN_AUTH', 'Chave administrativa inválida');
    const allow = await this.db.select().from(adminWhitelist).limit(1000);
    if (allow.length && !allow.some((entry) => matchesIp(request.ip, entry.cidr))) throw new AppError(403, 'ADMIN_IP', 'IP fora da whitelist');
    return key.id;
  }
  async audit(actor: string, action: string, resource: string, ip: string) {
    await this.db.insert(auditLogs).values({ actor, action, resource, ip });
  }
  auditList() { return this.db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100); }
  async config(): Promise<EngineConfig> {
    const [row] = await this.db.select().from(p2pConfig).where(eq(p2pConfig.id, 1)).limit(1);
    return row ?? { bufferSeconds: 15, maxUploadKbps: 2048, maxConnectionsPerNode: 4, maxPeersPerChannel: 256 };
  }
  async updateConfig(config: EngineConfig) { await this.db.insert(p2pConfig).values({ id: 1, ...config }).onConflictDoUpdate({ target: p2pConfig.id, set: config }); return config; }
  routes() { return this.db.select().from(streamRoutes).orderBy(streamRoutes.channel).limit(1000); }
  async saveRoute(input: z.infer<typeof routeDto>) {
    await this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(724992019)`);
      const ids = [...new Set([input.serverId, ...input.fallbackServerIds])];
      const servers = await transaction.select({ id: xuiServers.id }).from(xuiServers).where(inArray(xuiServers.id, ids));
      if (servers.length !== ids.length) throw new AppError(400, 'UNKNOWN_SERVER', 'Servidor de origem/fallback não existe');
      await transaction.insert(streamRoutes).values(input).onConflictDoUpdate({ target: streamRoutes.channel, set: input });
    });
    return input;
  }
  async deleteRoute(channel: string) { await this.db.delete(streamRoutes).where(eq(streamRoutes.channel, channel)); }
  keys() { return this.db.select({ id: adminKeys.id, name: adminKeys.name, createdAt: adminKeys.createdAt }).from(adminKeys).limit(200); }
  async createKey(name: string) {
    const secret = randomBytes(32).toString('hex');
    const [key] = await this.db.insert(adminKeys).values({ name, keyHash: digest(secret) }).returning({ id: adminKeys.id, name: adminKeys.name });
    return { ...key, secret };
  }
  async deleteKey(id: string) { await this.db.delete(adminKeys).where(eq(adminKeys.id, id)); }
  async renameKey(id: string, name: string) {
    const [key] = await this.db.update(adminKeys).set({ name }).where(eq(adminKeys.id, id)).returning({ id: adminKeys.id, name: adminKeys.name });
    if (!key) throw new AppError(404, 'KEY_NOT_FOUND', 'Chave não encontrada');
    return key;
  }
  whitelist() { return this.db.select().from(adminWhitelist).limit(1000); }
  async addIp(cidr: string) { return this.db.insert(adminWhitelist).values({ cidr }).onConflictDoNothing().returning(); }
  async deleteIp(id: string) { await this.db.delete(adminWhitelist).where(eq(adminWhitelist.id, id)); }
  async updateIp(id: string, cidr: string) {
    const [entry] = await this.db.update(adminWhitelist).set({ cidr }).where(eq(adminWhitelist.id, id)).returning();
    if (!entry) throw new AppError(404, 'RULE_NOT_FOUND', 'Regra não encontrada');
    return entry;
  }
}
