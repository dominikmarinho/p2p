import './patch-p2p.mjs';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../apps/webplayer/package.json', import.meta.url), 'utf8')).version;
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const build = process.env.APP_REVISION || git.stdout?.trim() || 'local';
rmSync(new URL('../public/player', import.meta.url), { recursive: true, force: true });
function bundle(mode, base, output) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '--workspace', 'highpass-webplayer'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'production', VITE_CLIENT_VERSION: version, VITE_CLIENT_BUILD: build, VITE_TRANSPORT_MODE: mode, PLAYER_BASE: base, PLAYER_OUT: output }, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  writeFileSync(new URL(`../public${base}version.json`, import.meta.url), JSON.stringify({ version, build, transport: mode }));
}
// The root bundle also serves the transport bridge used by the native player and server seeds.
bundle(process.env.BUILD_LEGACY_TEST_CLIENT === '1' ? '' : 'http', '/player/', '../../public/player');
for (const mode of ['http', 'p2p']) bundle(mode, `/player/${mode}/`, `../../public/player/${mode}`);
if (process.env.BUILD_LEGACY_TEST_CLIENT !== '1') {
  mkdirSync(new URL('../public/player', import.meta.url), { recursive: true });
  writeFileSync(new URL('../public/player/index.html', import.meta.url), `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Highpass · Escolha seu player</title><style>body{margin:0;background:#090f18;color:#eef4fc;font:18px system-ui;display:grid;min-height:100vh;place-content:center;padding:24px}main{max-width:660px}h1{color:#64e1b6}a{display:block;color:#090f18;background:#64e1b6;padding:20px;border-radius:12px;margin:18px 0;text-decoration:none;font-weight:700}p{line-height:1.6;color:#adbacd}small{display:block;color:#adbacd}</style><main><h1>HIGH PASS</h1><h2>Escolha seu player</h2><a href="/player/http/">Abrir WebPlayer HTTP →</a><p>Reprodução pela API HTTP, sem seeds nem WebRTC.</p><a href="/player/p2p/">Abrir WebPlayer P2P →</a><p>Vídeo exclusivamente por P2P. Se o seed ou os peers não entregarem, não utiliza HTTP de contingência.</p><small>Autenticação, catálogo e playlists usam a API nos dois clientes. Versão ${version}.</small><a href="/downloads/android/highpass-latest.apk">Baixar Android HTTP</a><a href="/downloads/android/p2p/highpass-latest.apk">Baixar Android P2P</a></main></html>`);
}
