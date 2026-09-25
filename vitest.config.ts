import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config. Each project maps to one root test command (BUILD_PROMPT section 8):
 * - unit:  unit, golden (E1-E9), content scenario and property tests (`pnpm test`)
 * - perft: perft suites (`pnpm test:perft`), slow, excluded from `unit`
 * - db:    repositories and migrations on SQLite (`pnpm test:db`)
 * Worker (Durable Object) tests run from apps/server with the Workers pool.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/**/*.test.ts',
            'apps/tools/**/*.test.ts',
            'apps/client/src/**/*.test.ts',
            'apps/server/src/**/*.unit.test.ts',
            'scripts/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/*.perft.test.ts', 'packages/db/**'],
          environment: 'node',
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'perft',
          include: ['packages/**/*.perft.test.ts'],
          environment: 'node',
          testTimeout: 600_000,
        },
      },
      {
        test: {
          name: 'db',
          include: ['packages/db/**/*.test.ts'],
          exclude: ['**/node_modules/**'],
          environment: 'node',
          testTimeout: 60_000,
        },
      },
    ],
  },
});
