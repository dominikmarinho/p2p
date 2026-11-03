import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';
import { hashPassword } from '../../src/lib/password.js';
if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL?.includes('highpass_test')) throw new Error('Banco isolado highpass_test obrigatório');
const app = buildApp(loadEnvironment({ ...process.env, RATE_LIMIT_NAMESPACE: `admin-test:${randomUUID()}:` }));
let cookie = '';
beforeAll(async () => { const pool = new Pool({ connectionString: process.env.DATABASE_URL }); try { await pool.query('UPDATE admin_users SET password_hash=$1, must_change_password=true,auth_version=auth_version+1 WHERE username=$2', [await hashPassword('admin'), 'admin']); } finally { await pool.end(); } await app.ready(); });
afterAll(async () => app.close());
describe('login administrativo', () => {
  it('recusa senha incorreta', async () => expect((await app.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'admin', password: 'wrong' } })).statusCode).toBe(401));
  it('autentica o seed e exige troca da senha inicial', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'admin', password: 'admin' } }); expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ username: 'admin', mustChangePassword: true }); cookie = String(result.headers['set-cookie']).split(';')[0] ?? ''; expect(cookie).toContain('HP_ADMIN=');
    expect((await app.inject({ url: '/api/admin/config', headers: { cookie } })).statusCode).toBe(403);
  });
  it('troca senha, libera o painel e revoga a sessão anterior', async () => {
    const previous = cookie; const result = await app.inject({ method: 'PUT', url: '/api/admin/change-password', headers: { cookie }, payload: { currentPassword: 'admin', newPassword: 'changed-admin-password-2026' } }); expect(result.statusCode).toBe(200); cookie = String(result.headers['set-cookie']).split(';')[0] ?? '';
    expect((await app.inject({ url: '/api/admin/config', headers: { cookie } })).statusCode).toBe(200); expect((await app.inject({ url: '/api/admin/config', headers: { cookie: previous } })).statusCode).toBe(401);
  });
  it('encerra a sessão no logout', async () => { expect((await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie } })).statusCode).toBe(204); expect((await app.inject({ url: '/api/admin/me', headers: { cookie } })).statusCode).toBe(401); });
});
