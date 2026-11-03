import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

const options = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
let active = 0;

async function derive(password: string, salt: string): Promise<Buffer> {
  if (active >= 4) throw new AppError(503, 'AUTH_BUSY', 'Autenticação ocupada; tente novamente');
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scryptCallback(password, salt, 64, options, (error, key) => {
        if (error) reject(error); else resolve(key);
      });
    });
  }
  finally { active--; }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, hash] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const derived = await derive(password, salt);
  return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}
