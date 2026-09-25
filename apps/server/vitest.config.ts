/**
 * Worker integration tests (`pnpm test:workers`, spec 17.1): the Worker, its Durable Objects, local D1
 * and R2 run inside workerd through @cloudflare/vitest-pool-workers. Unit tests of pure modules run in
 * the root Vitest project instead (`*.unit.test.ts`).
 */
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          AUTH_SECRET: 'workers-test-secret-0123456789abcdef0123456789abcdef',
          APP_ORIGIN: 'http://localhost',
          ADMIN_EMAILS: 'boss@example.com',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
