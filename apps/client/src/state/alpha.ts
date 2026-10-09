/**
 * Whether the server offers alpha guest play (spec 9.6, R-FMT-007): `null` until asked, `false`
 * when the Worker is unreachable or has the flag off. The title page shows the alpha call to action
 * only when it is `true`, so a production build without the flag shows nothing of it.
 */
import { signal } from '@preact/signals';
import { api } from '../net/api.ts';

export const alphaEnabled = signal<boolean | null>(null);

export async function refreshAlpha(): Promise<boolean> {
  try {
    alphaEnabled.value = (await api.alphaMe()).enabled;
  } catch {
    alphaEnabled.value = false;
  }
  return alphaEnabled.value;
}
