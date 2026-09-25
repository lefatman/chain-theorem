/**
 * Local profile for offline play (M3): a level and saved loadouts (up to MAX_SAVED_LOADOUTS, 7.4).
 * In local play every card and item is unlocked; online play (M4+) uses the server inventory.
 */
import { signal, effect } from '@preact/signals';
import { MAX_SAVED_LOADOUTS } from '@chain-theorem/content';
import type { Loadout } from '@chain-theorem/rules';

export interface SavedLoadout {
  id: string;
  name: string;
  level: number;
  loadout: Loadout;
}

const KEY = 'ct.profile.v1';

export const STARTER: SavedLoadout[] = [
  {
    id: 'starter-grove',
    name: 'Grove Starter',
    level: 5,
    loadout: { elements: ['grove'], items: ['dual_adepts_glove'], sets: [['poisoned_meat', 'last_word']] },
  },
  {
    id: 'starter-tide',
    name: 'Tide Skirmisher',
    level: 5,
    loadout: { elements: ['tide'], items: ['dual_adepts_glove'], sets: [['hit_and_run', 'scout']] },
  },
  {
    id: 'starter-ember',
    name: 'Ember Raider',
    level: 8,
    loadout: { elements: ['ember'], items: ['triple_adepts_gloves'], sets: [['cleave', 'backdraft', 'momentum']] },
  },
];

interface Profile {
  level: number;
  loadouts: SavedLoadout[];
}

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Profile;
  } catch {
    /* ignore */
  }
  return { level: 30, loadouts: STARTER };
}

export const profile = signal<Profile>(load());

effect(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile.value));
  } catch {
    /* ignore */
  }
});

export function saveLoadout(l: SavedLoadout): { ok: boolean; reason?: string } {
  const list = profile.value.loadouts.filter((x) => x.id !== l.id);
  if (list.length >= MAX_SAVED_LOADOUTS) return { ok: false, reason: `You can keep up to ${MAX_SAVED_LOADOUTS} loadouts.` };
  profile.value = { ...profile.value, loadouts: [...list, l] };
  return { ok: true };
}

export function deleteLoadout(id: string): void {
  profile.value = { ...profile.value, loadouts: profile.value.loadouts.filter((x) => x.id !== id) };
}
