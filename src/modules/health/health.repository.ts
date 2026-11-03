import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Database } from '../../db/index.js';

export class HealthRepository {
  constructor(private readonly db: Database, private readonly redis: Redis) {}

  async probe(): Promise<void> {
    await Promise.all([this.db.execute(sql`select 1`), this.redis.ping()]);
  }
}
