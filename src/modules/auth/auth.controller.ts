import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import type { Environment } from '../../config/env.js';
import type { Credentials } from './auth.dto.js';
import { tokenHash, type AuthService } from './auth.service.js';

export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly app: FastifyInstance,
    private readonly redis: Redis,
    private readonly env: Environment,
  ) {}

  register = (input: Credentials) => this.service.register(input);
  login = async (input: Credentials) => this.tokens(await this.service.login(input));
  refresh = async (token: string) => this.tokens(await this.service.refresh(token));
  logout = (token: string, userId: string) => this.service.logout(token, userId);

  async issueTicket(userId: string, expiresAt: number) {
    const ticket = randomBytes(32).toString('hex');
    await this.redis.set(`highpass:ws:${tokenHash(ticket)}`, JSON.stringify({ sub: userId, exp: expiresAt }), 'EX', 30);
    return { ticket, expiresIn: 30 };
  }

  private tokens(session: { userId: string; refreshToken: string }) {
    return {
      accessToken: this.app.jwt.sign({ sub: session.userId, type: 'access' }),
      refreshToken: session.refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}
