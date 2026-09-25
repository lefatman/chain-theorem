/**
 * Entering and leaving the world (M5): one WorldController per session, wired to the REST ticket,
 * the zone maps, the battle screen and the account. Loaded with the world screen (lazy chunk).
 */
import { effect } from '@preact/signals';
import { go } from '../app/router.ts';
import { api, wsUrl } from '../net/api.ts';
import { account, setSignedIn } from '../state/account.ts';
import { activeBattle, startOnlineBattle } from '../ui/battleSession.ts';
import { lessonSkippable, zoneGeometry } from './content.ts';
import { WorldController, type Encounter } from './controller.ts';
import { worldBattle, worldSession } from './session.ts';

const PREFS_KEY = 'ct.world.v1';

interface WorldPrefs {
  /** The adult player's own chat filter choice (R-SEC-011); unset = the zone's default. */
  filterChat?: boolean;
}

export function loadPrefs(): WorldPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as WorldPrefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(p: WorldPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...p }));
  } catch {
    /* storage unavailable: the choice lasts for this page */
  }
}

/**
 * Hand an encounter to the battle screen (ARCHITECTURE 9.2): the zone's `enc.url` already carries
 * a ticket for the first connect; reconnects ask for fresh ones. Resolves when the battle ends or
 * another battle replaces it.
 */
function handOff(enc: Encounter): Promise<void> {
  const battle = startOnlineBattle(enc.battleId, {
    battleId: enc.battleId,
    token: '',
    url: enc.url,
  });
  worldBattle.value = battle;
  go('battle');
  return new Promise((resolve) => {
    let done = false;
    let stop: (() => void) | null = null;
    stop = effect(() => {
      const over =
        battle.snapshot.value.status === 'ended' || activeBattle.value !== battle || done;
      if (!over) return;
      done = true;
      resolve();
      // Disposing inside the first synchronous run is not possible yet: defer it.
      queueMicrotask(() => stop?.());
    });
  });
}

/** The world session, created on first entry (and after leaving). */
export function enterWorld(): WorldController {
  const cur = worldSession.value;
  if (cur && !cur.isDisposed) return cur;
  const c = new WorldController({
    ticket: () => api.worldTicket(),
    socketUrl: wsUrl,
    geometry: zoneGeometry,
    skippable: (lesson) => lessonSkippable(lesson),
    onEncounter: handOff,
    onReward: (r) => {
      const acc = account.value;
      if (acc.kind === 'signed_in') setSignedIn({ ...acc.me, level: r.level });
    },
    ...(loadPrefs().filterChat !== undefined ? { filterChat: loadPrefs().filterChat } : {}),
  });
  worldSession.value = c;
  return c;
}

/** Leave the world: close the zone socket (the zone keeps the player's tile for the next visit). */
export function leaveWorld(): void {
  worldSession.value?.dispose();
  worldSession.value = null;
  worldBattle.value = null;
}
