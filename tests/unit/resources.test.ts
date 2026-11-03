import { expect, it } from 'vitest';
import { encryptResource, decryptResource } from '../../src/lib/secrets.js';
it('mantém URLs estáveis e autenticadas por grant, sem expor credenciais', () => {
  const key = 'ac'.repeat(32); const value = 'http://source/live/username/private-password/1.ts'; const token = encryptResource(value, key, 'grant-a');
  expect(encryptResource(value, key, 'grant-a')).toBe(token); expect(token).not.toContain('private-password'); expect(decryptResource(token, key, 'grant-a')).toBe(value);
  expect(() => decryptResource(token, key, 'grant-b')).toThrow(); expect(() => decryptResource(token.slice(0, -4) + 'xxxx', key, 'grant-a')).toThrow();
});
