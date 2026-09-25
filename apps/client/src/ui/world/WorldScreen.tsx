/**
 * The overworld screen (M5, spec 10): the Phaser map (lazy, 12.3) with DOM overlays (dialog,
 * lesson puzzles, banner, quest tracker, toasts, prompts, touch controls) and a side panel with
 * chat, players, party, friends, quests and settings. Loaded lazily from the app shell.
 *
 * The zone connection lives in a WorldController that outlives this screen while the player is in
 * a battle started from the world (the result panel offers "Return to the world").
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import type { Channel } from '@chain-theorem/protocol';
import { go, route } from '../../app/router.ts';
import { api, type Me, type Progress } from '../../net/api.ts';
import { account, refreshAccount } from '../../state/account.ts';
import { settings } from '../../state/settings.ts';
import { loadWorld, worldIndex, zoneName } from '../../world/content.ts';
import type { WorldGame } from '../../world/game.ts';
import { InputDriver, keyAction } from '../../world/input.ts';
import { enterWorld, leaveWorld } from '../../world/start.ts';
import { npcLook, playerLook, unknownNpcLook } from '../../world/trainers.ts';
import type { WorldSceneHost } from '../../world/WorldScene.ts';
import { COMPACT_QUERY, useMedia } from '../useMedia.ts';
import { ChatPanel, type WhisperTarget } from './ChatPanel.tsx';
import { DialogBox } from './DialogBox.tsx';
import { LessonPanel } from './LessonPanel.tsx';
import {
  FriendsPanel,
  PartyPanel,
  PlayersPanel,
  QuestsPanel,
  WorldSettingsPanel,
} from './SocialPanels.tsx';
import { ChallengeBanner, Prompts, QuestTracker, Toasts, TouchControls } from './StageOverlays.tsx';

type Tab = 'chat' | 'players' | 'party' | 'friends' | 'quests' | 'settings';
const TABS: Tab[] = ['chat', 'players', 'party', 'friends', 'quests', 'settings'];
const TAB_LABEL: Record<Tab, string> = {
  chat: 'Chat',
  players: 'Players',
  party: 'Party',
  friends: 'Friends',
  quests: 'Quests',
  settings: 'Settings',
};
const TOUCH_QUERY = '(pointer: coarse), (max-width: 760px)';

export function WorldScreen() {
  const acc = account.value;
  useEffect(() => {
    if (acc.kind === 'unknown') void refreshAccount();
  }, [acc.kind]);
  if (acc.kind === 'unknown')
    return (
      <main class="setup">
        <p>Connecting…</p>
      </main>
    );
  if (acc.kind !== 'signed_in')
    return (
      <main class="setup">
        <h2>The world</h2>
        <p>
          {acc.kind === 'offline'
            ? 'The server cannot be reached, so the world is unavailable. Local play still works.'
            : 'Sign in to enter the world.'}
        </p>
        {acc.kind === 'signed_out' && (
          <button class="primary" onClick={() => go('login')}>
            Sign in
          </button>
        )}
        <button onClick={() => go('title')}>Back</button>
      </main>
    );
  return <World me={acc.me} />;
}

function isField(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable ||
      t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT')
  );
}

function World({ me }: { me: Me }) {
  const c = useMemo(() => enterWorld(), []);
  const input = useMemo(() => new InputDriver(c), [c]);
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<WorldGame | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  const [channel, setChannel] = useState<Channel>('zone');
  const [target, setTarget] = useState<WhisperTarget | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const compact = useMedia(COMPACT_QUERY);
  const touch = useMedia(TOUCH_QUERY);
  const meRef = useRef(me);
  meRef.current = me;

  // The world content (maps, NPC looks, names) loads with this screen.
  useEffect(() => void loadWorld(), []);

  // Leaving the screen leaves the world, unless the world just handed the player to a battle.
  useEffect(
    () => () => {
      input.dispose();
      if (route.peek().name !== 'battle') leaveWorld();
    },
    [],
  );

  const whisper = (t: WhisperTarget) => {
    setTarget(t);
    setChannel('whisper');
    setTab('chat');
  };

  const interact = () => {
    const before = c.selected.peek();
    c.interact();
    const after = c.selected.peek();
    if (after && after !== before) setTab('players');
  };

  // ---- Phaser scene (lazy chunk) -----------------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    const sceneHost: WorldSceneHost = {
      controller: c,
      playerLook,
      npcLook: (id) => {
        const def = worldIndex.peek()?.npcs.get(id);
        return def ? npcLook(def.look) : unknownNpcLook(id);
      },
      ownName: () => meRef.current.name,
      textScale: () => settings.peek().textScale,
      onTile: (x, y) => {
        const players = [...c.players.peek().values()];
        // A tap on a head lands one tile up: check the tile below too.
        const p =
          players.find((q) => q.x === x && q.y === y) ??
          players.find((q) => q.x === x && q.y === y + 1);
        if (p) {
          c.select(p.p);
          setTab('players');
          return;
        }
        const n = c.npcs.peek().find((q) => q.x === x && (q.y === y || q.y === y + 1));
        if (n) {
          c.talkTo(n.id);
          return;
        }
        c.select(null);
      },
    };
    let destroy: ((g: WorldGame) => void) | null = null;
    void import('../../world/game.ts')
      .then(async ({ createWorldGame, destroyWorldGame }) => {
        destroy = destroyWorldGame;
        if (!host.current || disposed) return;
        const g = await createWorldGame(host.current, sceneHost);
        if (disposed) {
          destroyWorldGame(g);
          return;
        }
        game.current = g;
        setReady(true);
      })
      .catch((e: unknown) => {
        console.error('world failed to load', e);
        setFailed(true);
      });
    return () => {
      disposed = true;
      if (game.current) destroy?.(game.current);
      game.current = null;
    };
  }, [c]);

  // Redraw when looks or settings change (the scene sleeps otherwise).
  useSignalEffect(() => {
    void worldIndex.value;
    void settings.value.textScale;
    void c.battling.value;
    game.current?.scene.invalidate();
  });

  // ---- keyboard ----------------------------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isField(e.target)) return;
      const a = keyAction(e.key);
      if (!a) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest('.world-dialog, .lesson')) return;
      if (a === 'interact') {
        // Space and Enter keep their meaning on buttons; E always talks.
        if ((e.key === ' ' || e.key === 'Enter') && t?.closest('button, a, [role="tab"]')) return;
        e.preventDefault();
        if (!e.repeat) interact();
        return;
      }
      if (t?.closest('[role="tablist"]')) return;
      e.preventDefault();
      if (!e.repeat) input.press(a);
    };
    const up = (e: KeyboardEvent) => {
      const a = keyAction(e.key);
      if (a && a !== 'interact') input.release(a);
    };
    const blur = () => input.releaseAll();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [c, input]);

  // ---- progress (level, XP, coins), refreshed after rewards ----------------------------------------
  const rewards = c.toasts.value.filter((t) => t.kind === 'reward').length;
  useEffect(() => {
    api.progress().then(setProgress, () => setProgress(null));
  }, [rewards]);

  const conn = c.connection.value;
  const zone = c.zone.value;
  const battle = c.battle.value;
  const invites = c.invites.value.length;
  const unread = Object.values(c.unread.value).reduce((a, b) => a + b, 0);
  const players = c.roster.value.length;
  const badge: Partial<Record<Tab, string>> = {
    chat: unread > 0 ? String(unread) : '',
    players: players > 0 ? String(players) : '',
    party: invites > 0 ? `${invites} new` : '',
  };

  return (
    <main class={`world ${compact ? 'compact' : ''}`}>
      <header class="world-bar">
        <h2>
          {zone ? zoneName(zone.id) : 'The world'}
          {zone && zone.channel > 0 && (
            <span class="muted small-text channel"> · channel {zone.channel + 1}</span>
          )}
        </h2>
        {progress && (
          <span class="world-progress">
            <span>Lv {progress.level}</span>
            <span
              class="xp"
              role="meter"
              aria-label="Experience to the next level"
              aria-valuemin={0}
              aria-valuemax={progress.xpToNext}
              aria-valuenow={progress.xp}
            >
              <span
                style={{
                  width: `${Math.min(100, (100 * progress.xp) / Math.max(1, progress.xpToNext))}%`,
                }}
              />
            </span>
            <span class="small-text xp-text">
              {progress.xp}/{progress.xpToNext} XP
            </span>
            <span class="small-text">
              <span aria-hidden="true">◎</span> {progress.coins} coins
            </span>
          </span>
        )}
        <span class={`world-conn ${conn}`} role="status">
          {conn === 'open'
            ? ''
            : conn === 'connecting'
              ? 'Connecting…'
              : conn === 'reconnecting'
                ? 'Reconnecting…'
                : conn === 'warping'
                  ? 'Travelling…'
                  : (c.notice.value ?? 'Disconnected')}
        </span>
        {conn === 'closed' && (
          <button class="small" onClick={() => c.reconnect()}>
            Reconnect
          </button>
        )}
        <button
          class="small"
          aria-label="Leave the world"
          onClick={() => {
            leaveWorld();
            go('online');
          }}
        >
          Leave
        </button>
      </header>
      <div class="world-main">
        <section class="world-stage" aria-label="World map">
          <div class="world-host" ref={host} />
          {!ready && !failed && <p class="board-loading">Loading the world…</p>}
          {failed && <p class="board-loading">The map failed to load. Reload to try again.</p>}
          <ChallengeBanner c={c} />
          <QuestTracker c={c} />
          <Toasts c={c} />
          <Prompts c={c} />
          <DialogBox c={c} />
          {battle && (
            <div class="world-battling" role="status">
              <span aria-hidden="true">⚑</span> You are in a battle.{' '}
              <button class="primary small" onClick={() => go('battle')}>
                Resume battle
              </button>
            </div>
          )}
          {(conn === 'connecting' || conn === 'warping') && (
            <p class="world-wait" role="status">
              {conn === 'warping' ? 'Travelling…' : 'Entering the world…'}
            </p>
          )}
          {touch && <TouchControls input={input} onAction={interact} />}
          <p class="sr-only" aria-live="polite">
            {c.challengeZone.value ? 'You are in a challenge zone.' : ''}
          </p>
        </section>
        <aside class="world-side" aria-label="World panels">
          <div class="tabs" role="tablist" aria-label="World panels">
            {TABS.map((t, i) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`wtab-${t}`}
                aria-selected={t === tab}
                aria-controls="wpanel"
                tabIndex={t === tab ? 0 : -1}
                onClick={() => setTab(t)}
                onKeyDown={(e) => {
                  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const next = TABS[(i + d + TABS.length) % TABS.length] ?? t;
                  setTab(next);
                  document.getElementById(`wtab-${next}`)?.focus();
                }}
              >
                {TAB_LABEL[t]}
                {badge[t] && <span class="tab-badge"> ({badge[t]})</span>}
              </button>
            ))}
          </div>
          <div class="world-panel" role="tabpanel" id="wpanel" aria-labelledby={`wtab-${tab}`}>
            {tab === 'chat' && (
              <ChatPanel
                c={c}
                channel={channel}
                onChannel={setChannel}
                target={target}
                onTarget={setTarget}
              />
            )}
            {tab === 'players' && <PlayersPanel c={c} onWhisper={whisper} />}
            {tab === 'party' && <PartyPanel c={c} />}
            {tab === 'friends' && <FriendsPanel onWhisper={whisper} />}
            {tab === 'quests' && <QuestsPanel c={c} />}
            {tab === 'settings' && <WorldSettingsPanel c={c} />}
          </div>
          {!touch && (
            <p class="muted small-text world-keys">
              Arrows or WASD walk · E or Space talks · Tap a player for actions
            </p>
          )}
        </aside>
      </div>
      <LessonPanel c={c} />
    </main>
  );
}
