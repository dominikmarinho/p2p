import './patch-p2p.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '--workspace', 'highpass-webplayer'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
