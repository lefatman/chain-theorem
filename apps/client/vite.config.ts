import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// R-TECH-003: initial JS <= 600 KB gzipped. Phaser is lazy-loaded when a battle or the world opens,
// and the dev-only Scenario Lab is removed from production builds (import.meta.env.DEV branches).
export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
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
