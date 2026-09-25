// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const PURITY_GLOBALS = [
  {
    name: 'Date',
    message: 'packages/rules is pure: no clock reads (standing instruction, spec 0).',
  },
  { name: 'setTimeout', message: 'packages/rules is pure: no timers.' },
  { name: 'setInterval', message: 'packages/rules is pure: no timers.' },
  { name: 'fetch', message: 'packages/rules is pure: no I/O.' },
  { name: 'performance', message: 'packages/rules is pure: no clock reads.' },
  { name: 'crypto', message: 'packages/rules is pure: no unseeded randomness.' },
  { name: 'process', message: 'packages/rules is pure: no environment access.' },
  { name: 'console', message: 'packages/rules is pure: no I/O.' },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'reports/**',
      'apps/client/public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // R-DATA-001: rules is pure and depends on nothing; it never imports content.
    files: ['packages/rules/src/**/*.ts'],
    ignores: ['packages/rules/src/**/*.test.ts'],
    languageOptions: { globals: { ...globals.es2021 } },
    rules: {
      'no-restricted-globals': ['error', ...PURITY_GLOBALS],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'packages/rules: no unseeded randomness.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@chain-theorem/*'], message: 'packages/rules depends on nothing (13.1).' },
            { group: ['node:*'], message: 'packages/rules has no I/O.' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/ai/src/**/*.ts'],
    ignores: ['packages/ai/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@chain-theorem/*', '!@chain-theorem/rules', '!@chain-theorem/rules/*'],
              message: 'packages/ai depends only on rules (13.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/db/src/**/*.ts', 'packages/protocol/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@chain-theorem/*'],
              message: 'db and protocol depend on nothing inside the repo (13.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/client/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
);
