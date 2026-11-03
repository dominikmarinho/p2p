import './patch-p2p.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../apps/webplayer/package.json', import.meta.url), 'utf8')).version;
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const build = process.env.APP_REVISION || git.stdout?.trim() || 'local';
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '--workspace', 'highpass-webplayer'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, NODE_ENV: 'production', VITE_CLIENT_VERSION: version, VITE_CLIENT_BUILD: build }, stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status === 0) writeFileSync(new URL('../public/player/version.json', import.meta.url), JSON.stringify({ version, build }));
process.exitCode = result.status ?? 1;
