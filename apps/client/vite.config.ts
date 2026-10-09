import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// R-TECH-003: initial JS <= 600 KB gzipped. Phaser is lazy-loaded when a battle or the world opens,
// and the dev-only Scenario Lab is removed from production builds (import.meta.env.DEV branches).
/**
 * With no Worker running (the local e2e, or `vite` alone) an API call answers `{ error: 'no_server' }`
 * with status 200 instead of the proxy's 502, so the browser logs no network error and the client
 * treats the server as absent (`net/api.ts`), exactly as a static build without a Worker does.
 */
function quietWhenDown(proxy: {
  on(event: 'error', fn: (...args: unknown[]) => void): void;
}): void {
  proxy.on('error', (_err, _req, res) => {
    const r = res as {
      headersSent?: boolean;
      writeHead?: (s: number, h: object) => void;
      end?: (b: string) => void;
    };
    if (typeof r.writeHead !== 'function' || typeof r.end !== 'function' || r.headersSent) return;
    r.writeHead(200, { 'content-type': 'application/json' });
    r.end(JSON.stringify({ error: 'no_server' }));
  });
}

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', configure: quietWhenDown },
      '/admin': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  worker: { format: 'es' },
});
