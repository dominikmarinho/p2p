import { randomBytes } from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../../db/index.js';
import { adminUsers } from '../../db/schema.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { digest } from '../../lib/secrets.js';
import { AppError } from '../../lib/errors.js';

export class AdminAuthService {
  constructor(private readonly db: Database, private readonly redis: Redis) {}
  token(request: FastifyRequest) { return request.headers.cookie?.match(/(?:^|;\s*)HP_ADMIN=([a-f0-9]{64})(?:;|$)/)?.[1]; }
  async login(username: string, password: string) {
    const [user] = await this.db.select().from(adminUsers).where(eq(adminUsers.username, username)).limit(1);
    if (!user || !await verifyPassword(password, user.passwordHash)) throw new AppError(401, 'ADMIN_LOGIN', 'Usuário ou senha inválidos');
    return this.issue(user);
  }
  private async issue(user: typeof adminUsers.$inferSelect) {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(`highpass:admin-session:${digest(token)}`, JSON.stringify({ id: user.id, version: user.authVersion }), 'EX', 28800);
    return { token, user: { username: user.username, mustChangePassword: user.mustChangePassword } };
  }
  async user(request: FastifyRequest) {
    const token = this.token(request); const raw = token ? await this.redis.get(`highpass:admin-session:${digest(token)}`) : null;
    if (!raw) throw new AppError(401, 'ADMIN_SESSION', 'Entre no painel');
    const session = JSON.parse(raw) as { id: string; version: number };
    const [user] = await this.db.select().from(adminUsers).where(and(eq(adminUsers.id, session.id), eq(adminUsers.authVersion, session.version))).limit(1);
    if (!user) throw new AppError(401, 'ADMIN_SESSION', 'Sessão encerrada');
    return user;
  }
  async logout(request: FastifyRequest) { const token = this.token(request); if (token) await this.redis.del(`highpass:admin-session:${digest(token)}`); }
  async changePassword(request: FastifyRequest, currentPassword: string, newPassword: string) {
    const user = await this.user(request);
    if (!await verifyPassword(currentPassword, user.passwordHash)) throw new AppError(401, 'ADMIN_PASSWORD', 'Senha atual inválida');
    if (currentPassword === newPassword) throw new AppError(400, 'ADMIN_PASSWORD', 'Escolha uma senha diferente');
    const [updated] = await this.db.update(adminUsers).set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false, authVersion: sql`${adminUsers.authVersion} + 1` }).where(and(eq(adminUsers.id, user.id), eq(adminUsers.authVersion, user.authVersion))).returning();
    if (!updated) throw new AppError(409, 'ADMIN_PASSWORD', 'Senha alterada em outra sessão; entre novamente');
    await this.logout(request); return this.issue(updated);
  }
}
