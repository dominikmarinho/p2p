import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: process.env.PLAYER_BASE ?? '/player/',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api/iptv': { target: process.env.ENGINE_PROXY_URL ?? 'http://127.0.0.1:3000', ws: true } } },
  build: { outDir: process.env.PLAYER_OUT ?? '../../public/player', emptyOutDir: true, rollupOptions: { input: { player: resolve(import.meta.dirname, 'index.html'), bridge: resolve(import.meta.dirname, 'android-bridge.html') } }, chunkSizeWarningLimit: 1200 },
});
