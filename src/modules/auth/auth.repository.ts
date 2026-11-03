import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { refreshTokens, users } from '../../db/schema.js';

type NewSession = { userId: string; tokenHash: string; expiresAt: Date };

export class AuthRepository {
  constructor(private readonly db: Database) {}

  async findByEmail(email: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  async createUser(email: string, passwordHash: string) {
    const [user] = await this.db.insert(users).values({ email, passwordHash }).returning({ id: users.id });
    if (!user) throw new Error('INSERT de usuário sem retorno');
    return user;
  }

  async createSession(session: NewSession): Promise<void> {
    await this.db.insert(refreshTokens).values({ ...session, familyId: randomUUID() });
  }

  async rotate(oldHash: string, newHash: string): Promise<string | undefined> {
    return this.db.transaction(async (transaction) => {
      // Serializa refresh e logout da mesma família, inclusive replay de tokens antigos.
      const [candidate] = await transaction.select({ familyId: refreshTokens.familyId })
        .from(refreshTokens).where(eq(refreshTokens.tokenHash, oldHash)).limit(1);
      if (!candidate) return undefined;
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${candidate.familyId}, 0))`);
      const [session] = await transaction.select().from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, oldHash)).for('update');
      if (!session) return undefined;
      if (session.revokedAt || session.expiresAt <= new Date()) {
        await transaction.update(refreshTokens).set({ revokedAt: new Date() })
          .where(eq(refreshTokens.familyId, session.familyId));
        return undefined; // Commit da revogação, mesmo na tentativa inválida.
      }
      await transaction.update(refreshTokens).set({ revokedAt: new Date() })
        .where(eq(refreshTokens.id, session.id));
      await transaction.insert(refreshTokens).values({
        userId: session.userId, tokenHash: newHash,
        familyId: session.familyId, expiresAt: session.expiresAt,
      });
      return session.userId;
    });
  }

  async revoke(tokenHash: string, userId: string): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const [session] = await transaction.select().from(refreshTokens).where(and(
        eq(refreshTokens.tokenHash, tokenHash), eq(refreshTokens.userId, userId),
      )).limit(1);
      if (!session) return;
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${session.familyId}, 0))`);
      await transaction.update(refreshTokens).set({ revokedAt: new Date() })
        .where(eq(refreshTokens.familyId, session.familyId));
    });
  }
}
