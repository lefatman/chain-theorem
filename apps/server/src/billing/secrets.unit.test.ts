/**
 * R-SEC-009: billing secrets live only in Worker secrets. The client never names them, never imports
 * the server's billing code, and a built client bundle (when one exists) contains no key material.
 * The repository-wide scan is `scripts/secret-scan.ts` (CI).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../..', import.meta.url).pathname;
const SECRET_NAMES = [
  'PADDLE_API_KEY',
  'PADDLE_WEBHOOK_SECRET',
  'FAKE_BILLING_SECRET',
  'AUTH_SECRET',
];
const KEY_PATTERNS = [/pdl_(?:live|sdbx)_apikey_/, /pdl_ntfset_/];

function files(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

describe('billing secrets (R-SEC-009)', () => {
  it('R-SEC-009 the client source never names a billing secret or imports server billing code', () => {
    const src = files(join(ROOT, 'apps/client/src'), /\.(ts|tsx)$/);
    expect(src.length).toBeGreaterThan(10);
    for (const f of src) {
      const text = readFileSync(f, 'utf8');
      for (const name of SECRET_NAMES)
        expect(text.includes(name), `${f} names ${name}`).toBe(false);
      expect(/apps\/server|server\/src\/billing/.test(text), `${f} imports server code`).toBe(
        false,
      );
      for (const re of KEY_PATTERNS) expect(re.test(text), `${f} holds a key`).toBe(false);
    }
  });

  it('R-SEC-009 a built client bundle holds no billing secret names or key material', () => {
    const dist = files(join(ROOT, 'apps/client/dist'), /\.(js|html|css|json|webmanifest)$/);
    for (const f of dist) {
      const text = readFileSync(f, 'utf8');
      for (const name of SECRET_NAMES)
        expect(text.includes(name), `${f} names ${name}`).toBe(false);
      for (const re of KEY_PATTERNS) expect(re.test(text), `${f} holds a key`).toBe(false);
    }
  });
});
