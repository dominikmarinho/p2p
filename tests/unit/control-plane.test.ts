import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, equalSecret } from '../../src/lib/secrets.js';
import { matchesIp, validCidr } from '../../src/modules/admin/admin.dto.js';

describe('segredos e rede administrativa', () => {
  it('cifra, autentica e não aceita ciphertext alterado', () => {
    const key = 'a'.repeat(64); const encrypted = encrypt('secret', key);
    expect(encrypted).not.toContain('secret'); expect(decrypt(encrypted, key)).toBe('secret');
    expect(() => decrypt(encrypted, 'b'.repeat(64))).toThrow();
    expect(equalSecret('same', 'same')).toBe(true); expect(equalSecret('different', 'same')).toBe(false);
  });
  it('valida IPs/CIDRs e trata endereços IPv4 mapeados', () => {
    expect(validCidr('127.0.0.1/32')).toBe(true); expect(validCidr('127.0.0.1/33')).toBe(false);
    expect(validCidr('::1/128')).toBe(true); expect(validCidr('127.0.0.1/')).toBe(false);
    expect(matchesIp('::ffff:127.0.0.1', '127.0.0.0/8')).toBe(true);
    expect(matchesIp('192.0.2.1', '127.0.0.0/8')).toBe(false);
  });
});
