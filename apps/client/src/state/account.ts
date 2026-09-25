/**
 * The signed-in account (M4). `unknown` until the first /api/me answer; `offline` when no server
 * answers (a static build without the Worker): local play keeps working either way.
 */
import { signal } from '@preact/signals';
import { ApiError, api, onSubscriptionRequired, type Me } from '../net/api.ts';

export type AccountState =
  | { kind: 'unknown' }
  | { kind: 'offline' }
  | { kind: 'signed_out' }
  | { kind: 'signed_in'; me: Me };

export const account = signal<AccountState>({ kind: 'unknown' });

export async function refreshAccount(): Promise<AccountState> {
  try {
    const { me } = await api.me();
    account.value = me ? { kind: 'signed_in', me } : { kind: 'signed_out' };
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'offline';
    account.value =
      code === 'offline' || code === 'no_server' ? { kind: 'offline' } : { kind: 'signed_out' };
  }
  return account.value;
}

// A 402 anywhere (the trial ended while the app was open): re-read the account so every screen
// shows the "trial has ended" state (M6 6.3).
onSubscriptionRequired(() => void refreshAccount());

export function setSignedIn(me: Me): void {
  account.value = { kind: 'signed_in', me };
}

export async function signOut(): Promise<void> {
  try {
    await api.signOut();
  } finally {
    account.value = { kind: 'signed_out' };
  }
}
