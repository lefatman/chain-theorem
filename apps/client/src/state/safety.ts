/**
 * The player's own mute and block lists (M6 6.4, R-SEC-011), as the server last described them, and
 * the report dialog's target. The server applies mutes and blocks where lines are delivered; the
 * client also hides lines it already showed from someone the player just muted or blocked.
 */
import { computed, signal } from '@preact/signals';
import type { ReportContext, SafetyLists } from '@chain-theorem/protocol';
import { ApiError, api } from '../net/api.ts';

export const safety = signal<SafetyLists | null>(null);

export const mutedIds = computed(() => new Set(safety.value?.muted.map((m) => m.id) ?? []));
export const blockedIds = computed(() => new Set(safety.value?.blocked.map((b) => b.id) ?? []));

/** Lines from this player are hidden (muted or blocked). */
export function hidden(id: string): boolean {
  return mutedIds.value.has(id) || blockedIds.value.has(id);
}

export async function loadSafety(): Promise<SafetyLists> {
  const lists = await api.safety();
  safety.value = lists;
  return lists;
}

export async function setMuted(id: string, on: boolean): Promise<SafetyLists> {
  const lists = on ? await api.mute(id) : await api.unmute(id);
  safety.value = lists;
  return lists;
}

export async function setBlocked(id: string, on: boolean): Promise<SafetyLists> {
  const lists = on ? await api.block(id) : await api.unblock(id);
  safety.value = lists;
  return lists;
}

/** Friendly text for the safety and report routes' error codes. */
export function safetyError(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'error';
  const known: Record<string, string> = {
    too_many: 'Your list is full. Remove someone first (Settings, Safety).',
    too_many_reports: 'You have sent a lot of reports today. Please try again tomorrow.',
    not_found: 'That player no longer exists.',
    bad_target: 'You cannot do that to yourself.',
    signed_out: 'Sign in first.',
    offline: 'The server cannot be reached.',
  };
  return known[code] ?? `Something went wrong (${code}).`;
}

/** Who the report dialog is about, and what (a chat line), while it is open. */
export interface ReportTarget {
  p: string;
  name: string;
  context?: ReportContext;
}

export const reportTarget = signal<ReportTarget | null>(null);

export function openReport(t: ReportTarget): void {
  reportTarget.value = t;
}

export function closeReport(): void {
  reportTarget.value = null;
}
