import { aessiv } from '@noble/ciphers/aes.js';
import { createHmac, createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function equalSecret(value: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(digest(value), 'hex'), Buffer.from(digest(expected), 'hex'));
}
export function encrypt(value: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}
export function decrypt(value: string, key: string): string {
  const [iv, tag, encrypted] = value.split('.');
  if (!iv || !tag || !encrypted) throw new Error('Segredo cifrado inválido');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'base64url'));
  cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64url')), cipher.final()]).toString('utf8');
}

// RFC 5297: URLs estáveis por grant sem reutilizar nonce GCM entre mensagens.
export function encryptResource(value: string, key: string, grant: string): string {
  const derived = createHmac('sha512', Buffer.from(key, 'hex')).update(`highpass-resource-v1:${grant}`).digest();
  return 's1.' + Buffer.from(aessiv(derived, Buffer.from(grant)).encrypt(Buffer.from(value))).toString('base64url');
}
export function decryptResource(value: string, key: string, grant: string): string {
  if (!value.startsWith('s1.')) return decrypt(value, key);
  const derived = createHmac('sha512', Buffer.from(key, 'hex')).update(`highpass-resource-v1:${grant}`).digest();
  return Buffer.from(aessiv(derived, Buffer.from(grant)).decrypt(Buffer.from(value.slice(3), 'base64url'))).toString('utf8');
}
