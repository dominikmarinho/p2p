import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';
import { loadEnvironment } from '../../src/config/env.js';
import { createNoteDto, updateNoteDto } from '../../src/modules/notes/notes.dto.js';

describe('fronteiras de segurança', () => {
  it('armazena hash com salt e rejeita senha incorreta', async () => {
    const first = await hashPassword('correct-horse-password');
    const second = await hashPassword('correct-horse-password');
    expect(first).not.toEqual(second);
    expect(await verifyPassword('correct-horse-password', first)).toBe(true);
    expect(await verifyPassword('wrong-horse-password', first)).toBe(false);
    expect(await verifyPassword('any', 'corrupted')).toBe(false);
  });
  it('rejeita ambiente incompleto sem expor o valor dos segredos', () => {
    expect(() => loadEnvironment({ JWT_SECRET: 'sensitive' })).toThrow('JWT_SECRET');
    expect(() => loadEnvironment({ JWT_SECRET: 'sensitive' })).not.toThrow('sensitive');
  });
  it('rejeita mass assignment, corpo vazio e conteúdo acima do limite', () => {
    expect(createNoteDto.safeParse({ title: 'Test', content: '', ownerId: 'other' }).success).toBe(false);
    expect(updateNoteDto.safeParse({}).success).toBe(false);
    expect(createNoteDto.safeParse({ title: 'Test', content: 'a'.repeat(10001) }).success).toBe(false);
  });
});
