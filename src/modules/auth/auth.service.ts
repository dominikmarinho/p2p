import { createHash, randomBytes } from 'node:crypto';
import type { Environment } from '../../config/env.js';
import { AppError, isUniqueViolation } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { Credentials } from './auth.dto.js';
import type { AuthRepository } from './auth.repository.js';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(48).toString('hex');
const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Credenciais inválidas');
const dummyHash = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;

export class AuthService {
  constructor(private readonly repository: AuthRepository, private readonly env: Environment) {}

  async register(input: Credentials) {
    try { return await this.repository.createUser(input.email, await hashPassword(input.password)); }
    catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'EMAIL_EXISTS', 'Email já cadastrado');
      throw error;
    }
  }

  async login(input: Credentials) {
    const user = await this.repository.findByEmail(input.email);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? dummyHash);
    if (!user || !valid) throw invalidCredentials();
    const refreshToken = newToken();
    await this.repository.createSession({
      userId: user.id, tokenHash: tokenHash(refreshToken),
      expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    return { userId: user.id, refreshToken };
  }

  async refresh(oldToken: string) {
    const refreshToken = newToken();
    const userId = await this.repository.rotate(tokenHash(oldToken), tokenHash(refreshToken));
    if (!userId) throw new AppError(401, 'INVALID_REFRESH', 'Refresh token inválido ou reutilizado');
    return { userId, refreshToken };
  }

  async logout(refreshToken: string, userId: string): Promise<void> {
    await this.repository.revoke(tokenHash(refreshToken), userId);
  }
}
