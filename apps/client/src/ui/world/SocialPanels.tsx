/**
 * World side panels (M5, spec 10.4, 10.5, R-SEC-011): players here (whisper, party invite, friend
 * request, consent-based challenges; a quick Challenge on nearby players inside a challenge zone,
 * R-WORLD-006; M6: Trade and Wager battle, off with the reason for trial accounts, 14.4; M6 6.4:
 * Mute, Block and Report for everyone, R-SEC-011), the party, friends (REST), quests, and settings
 * (own chat filter, new-player hints, the mute and block lists).
 */
import { useEffect, useState } from 'preact/hooks';
import { FORMATS } from '@chain-theorem/content';
import type { Format } from '@chain-theorem/protocol';
import { ApiError, api, type Friend } from '../../net/api.ts';
import {
  accessReason,
  activeTrade,
  loadTradeAccess,
  openTrade,
  tradeAccess,
  tradeApiError,
} from '../../trade/session.ts';
import { account } from '../../state/account.ts';
import {
  blockedIds,
  loadSafety,
  mutedIds,
  openReport,
  safety,
  safetyError,
  setBlocked,
  setMuted,
} from '../../state/safety.ts';
import { SafetyPanel } from '../SafetyPanel.tsx';
import { settings, updateSettings } from '../../state/settings.ts';
import { worldIndex, zoneName } from '../../world/content.ts';
import type { WorldController } from '../../world/controller.ts';
import { savePrefs } from '../../world/start.ts';
import type { WhisperTarget } from './ChatPanel.tsx';

/** Tiles within which the challenge-zone quick Challenge shows (10.4). */
export const NEAR_TILES = 6;
const PARTY_MAX = 4;

function apiError(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'error';
  const known: Record<string, string> = {
    not_found: 'No player with that name.',
    offline: 'The server cannot be reached.',
  };
  return known[code] ?? `Something went wrong (${code}).`;
}

/** Mute, Block (with a confirmation) and Report for one player (M6 6.4, R-SEC-011). */
export function SafetyActions({
  p,
  name,
  onNote,
}: {
  p: string;
  name: string;
  onNote(text: string | null): void;
}) {
  const muted = mutedIds.value.has(p);
  const blocked = blockedIds.value.has(p);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (safety.peek() === null) loadSafety().catch(() => undefined);
  }, []);
  useEffect(() => setConfirm(false), [p]);
  const act = async (f: () => Promise<unknown>, done: string) => {
    onNote(null);
    try {
      await f();
      onNote(done);
    } catch (e) {
      onNote(safetyError(e));
    }
  };
  return (
    <>
      <div class="row start" role="group" aria-label={`Safety for ${name}`}>
        <button
          type="button"
          aria-pressed={muted}
          onClick={() =>
            void act(
              () => setMuted(p, !muted),
              muted
                ? `${name} is no longer muted.`
                : `You muted ${name}. Their messages are hidden from you.`,
            )
          }
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type="button"
          class={blocked ? '' : 'danger'}
          aria-pressed={blocked}
          onClick={() =>
            blocked
              ? void act(() => setBlocked(p, false), `${name} is no longer blocked.`)
              : setConfirm(true)
          }
        >
          {blocked ? 'Unblock' : 'Block'}
        </button>
        <button type="button" onClick={() => openReport({ p, name })}>
          <span aria-hidden="true">⚑</span> Report
        </button>
      </div>
      {confirm && (
        <div class="note warn small-text" role="group" aria-label={`Confirm blocking ${name}`}>
          <p>
            Block {name}? Their messages are hidden, neither of you can whisper, challenge, invite
            or trade with the other, and a friendship between you ends. They are not told.
          </p>
          <div class="row start">
            <button
              type="button"
              class="danger"
              onClick={() => {
                setConfirm(false);
                void act(
                  () => setBlocked(p, true),
                  `You blocked ${name}. Unblock them any time in Settings.`,
                );
              }}
            >
              Yes, block {name}
            </button>
            <button type="button" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Battling() {
  return (
    <span class="tag battling">
      <span aria-hidden="true">⚑</span> in battle
    </span>
  );
}

export interface PlayersPanelProps {
  c: WorldController;
  onWhisper(t: WhisperTarget): void;
}

export function PlayersPanel({ c, onWhisper }: PlayersPanelProps) {
  const roster = c.roster.value;
  const me = c.me.value;
  const selected = c.selected.value;
  const inside = c.challengeZone.value;
  const party = c.party.value;
  const zone = c.zone.value;
  const zoneFormat = ((zone && worldIndex.value?.zones.get(zone.id)?.format) ??
    'first_blood') as Format;
  const [format, setFormat] = useState<Format>('first_blood');
  const [note, setNote] = useState<string | null>(null);
  const players = c.players.peek();
  const dist = (p: string) => {
    const q = players.get(p);
    return q && me ? Math.max(Math.abs(q.x - me.x), Math.abs(q.y - me.y)) : Infinity;
  };
  const rows = [...roster].sort((a, b) => dist(a.p) - dist(b.p) || a.name.localeCompare(b.name));
  const inParty = new Set(party?.members.map((m) => m.p) ?? []);
  const sel = roster.find((r) => r.p === selected) ?? null;
  // M6 6.1: trades and wagers are for subscribers (14.4); the reason shows when they are off.
  const locked = accessReason(tradeAccess.value);
  const trading = activeTrade.value !== null;
  useEffect(() => void loadTradeAccess(), []);
  const trade = async (p: string, name: string, mode: 'trade' | 'wager') => {
    setNote(null);
    try {
      openTrade(await api.startTrade(p, mode, mode === 'wager' ? 'first_blood' : undefined));
    } catch (e) {
      setNote(tradeApiError(e, name));
    }
  };

  const addFriend = async (p: string, name: string) => {
    setNote(null);
    try {
      const r = await api.addFriend(p);
      setNote(
        r.status === 'friends'
          ? `You and ${name} are now friends.`
          : `Friend request sent to ${name}.`,
      );
    } catch (e) {
      setNote(apiError(e));
    }
  };

  return (
    <section class="world-players" aria-label="Players here">
      {inside && (
        <p class="note warn small-text">
          <span aria-hidden="true">⚔</span> Challenge zone: challenge anyone nearby straight away.
        </p>
      )}
      {rows.length === 0 && <p class="muted">Nobody else is here right now.</p>}
      <ul class="player-list">
        {rows.map((r) => {
          const d = dist(r.p);
          const near = d <= NEAR_TILES;
          return (
            <li key={r.p} class={r.p === selected ? 'selected' : ''}>
              <button
                type="button"
                class="player-name"
                aria-pressed={r.p === selected}
                onClick={() => c.select(r.p === selected ? null : r.p)}
              >
                <strong>{r.name}</strong> <span class="muted">Lv {r.level}</span>
                {Number.isFinite(d) && <span class="muted small-text"> · {d} tiles</span>}
              </button>
              {r.battling && <Battling />}
              {inside && near && !r.battling && !c.battling.value && (
                <button
                  type="button"
                  class="small primary"
                  onClick={() => c.challenge(r.p, zoneFormat)}
                >
                  Challenge
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {sel && (
        <div class="player-actions panel" aria-label={`Actions for ${sel.name}`}>
          <h4>{sel.name}</h4>
          <div class="row start">
            <button type="button" onClick={() => onWhisper({ p: sel.p, name: sel.name })}>
              Whisper
            </button>
            <button
              type="button"
              disabled={inParty.has(sel.p) || (party?.members.length ?? 1) >= PARTY_MAX}
              onClick={() => {
                c.invite(sel.p);
                setNote(`Party invite sent to ${sel.name}.`);
              }}
            >
              Invite to party
            </button>
            <button type="button" onClick={() => void addFriend(sel.p, sel.name)}>
              Add friend
            </button>
          </div>
          <div class="row start">
            <button
              type="button"
              disabled={locked !== null || trading || sel.battling || c.battling.value}
              aria-describedby={locked ? 'trade-locked' : undefined}
              onClick={() => void trade(sel.p, sel.name, 'trade')}
            >
              <span aria-hidden="true">⇄</span> Trade
            </button>
            <button
              type="button"
              disabled={locked !== null || trading || sel.battling || c.battling.value}
              aria-describedby={locked ? 'trade-locked' : undefined}
              onClick={() => void trade(sel.p, sel.name, 'wager')}
            >
              <span aria-hidden="true">⚔</span> Wager battle
            </button>
          </div>
          {locked && (
            <p id="trade-locked" class="muted small-text">
              {locked}
            </p>
          )}
          <SafetyActions p={sel.p} name={sel.name} onNote={setNote} />
          {!inside && (
            <div class="row start">
              <label class="inline">
                Format
                <select
                  value={format}
                  onChange={(e) => setFormat((e.target as HTMLSelectElement).value as Format)}
                >
                  {Object.values(FORMATS).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                class="primary"
                disabled={sel.battling || c.battling.value}
                onClick={() => {
                  c.challenge(sel.p, format);
                  setNote(`Challenge sent to ${sel.name}: they choose whether to accept.`);
                }}
              >
                Challenge
              </button>
            </div>
          )}
        </div>
      )}
      {note && (
        <p class="note small-text" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

export function PartyPanel({ c }: { c: WorldController }) {
  const party = c.party.value;
  const invites = c.invites.value;
  const roster = c.roster.value;
  const me = c.me.value;
  const [pick, setPick] = useState('');
  const members = new Set(party?.members.map((m) => m.p) ?? []);
  const candidates = roster.filter((r) => !members.has(r.p));
  const full = (party?.members.length ?? 1) >= PARTY_MAX;
  return (
    <section class="world-party" aria-label="Party">
      {invites.length > 0 && (
        <ul class="invite-list">
          {invites.map((i) => (
            <li key={i.id}>
              <strong>{i.name}</strong> invites you to a party.{' '}
              <button type="button" class="small primary" onClick={() => c.replyInvite(i.id, true)}>
                Accept
              </button>{' '}
              <button type="button" class="small" onClick={() => c.replyInvite(i.id, false)}>
                Decline
              </button>
            </li>
          ))}
        </ul>
      )}
      {party ? (
        <>
          <h4>Your party</h4>
          <ul class="member-list">
            {party.members.map((m) => (
              <li key={m.p}>
                {m.p === party.leader && (
                  <span class="tag" title="Party leader">
                    <span aria-hidden="true">★</span> leader
                  </span>
                )}{' '}
                <strong>{m.p === me?.p ? `${m.name} (you)` : m.name}</strong>{' '}
                <span class="muted small-text">
                  {m.zone ? `in ${zoneName(m.zone)}` : 'offline'}
                </span>
              </li>
            ))}
          </ul>
          <p class="muted small-text">When the leader moves to another zone, the party follows.</p>
          <button type="button" class="danger" onClick={() => c.leaveParty()}>
            Leave party
          </button>
        </>
      ) : (
        <p class="muted">You are not in a party. Invite someone here to travel together.</p>
      )}
      <div class="row start">
        <select
          value={pick}
          aria-label="Player to invite"
          onChange={(e) => setPick((e.target as HTMLSelectElement).value)}
        >
          <option value="">Invite a player here…</option>
          {candidates.map((r) => (
            <option key={r.p} value={r.p}>
              {r.name} (Lv {r.level})
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!pick || full}
          onClick={() => {
            c.invite(pick);
            setPick('');
          }}
        >
          Invite
        </button>
      </div>
      {full && <p class="muted small-text">A party holds {PARTY_MAX} players.</p>}
    </section>
  );
}

export function FriendsPanel({ onWhisper }: { onWhisper(t: WhisperTarget): void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const load = async () => {
    try {
      setFriends((await api.friends()).friends);
    } catch (e) {
      setNote(apiError(e));
      setFriends([]);
    }
  };
  useEffect(() => void load(), []);
  const act = async (f: () => Promise<unknown>, done?: string) => {
    setNote(null);
    try {
      await f();
      if (done) setNote(done);
      await load();
    } catch (e) {
      setNote(apiError(e));
    }
  };
  const group = (s: Friend['status']) => (friends ?? []).filter((f) => f.status === s);
  const mutual = group('friends');
  const incoming = group('incoming');
  const outgoing = group('outgoing');
  return (
    <section class="world-friends" aria-label="Friends">
      <form
        class="row start"
        onSubmit={(e) => {
          e.preventDefault();
          const to = name.trim();
          if (!to) return;
          void act(() => api.addFriend(to), `Friend request sent to ${to}.`).then(() =>
            setName(''),
          );
        }}
      >
        <input
          type="text"
          value={name}
          maxLength={64}
          placeholder="Player name"
          aria-label="Add a friend by name"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <button type="submit" disabled={!name.trim()}>
          Add friend
        </button>
      </form>
      {note && (
        <p class="note small-text" role="status">
          {note}
        </p>
      )}
      {friends === null && <p class="muted">Loading…</p>}
      {incoming.length > 0 && (
        <>
          <h4>Requests</h4>
          <ul class="friend-list">
            {incoming.map((f) => (
              <li key={f.id}>
                <strong>{f.name}</strong>{' '}
                <button
                  type="button"
                  class="small primary"
                  onClick={() => void act(() => api.addFriend(f.id))}
                >
                  Accept
                </button>{' '}
                <button
                  type="button"
                  class="small"
                  onClick={() => void act(() => api.removeFriend(f.id))}
                >
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {friends !== null && (
        <>
          <h4>Friends</h4>
          {mutual.length === 0 && <p class="muted small-text">No friends yet.</p>}
          <ul class="friend-list">
            {mutual.map((f) => (
              <li key={f.id}>
                <span aria-hidden="true">{f.zone ? '●' : '○'}</span> <strong>{f.name}</strong>{' '}
                <span class="muted small-text">
                  {f.zone ? `in ${zoneName(f.zone)}` : 'offline'}
                </span>{' '}
                {f.zone && (
                  <button
                    type="button"
                    class="small"
                    onClick={() => onWhisper({ p: f.id, name: f.name })}
                  >
                    Whisper
                  </button>
                )}{' '}
                <button
                  type="button"
                  class="small ghost"
                  onClick={() => void act(() => api.removeFriend(f.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <h4>Sent requests</h4>
          <ul class="friend-list">
            {outgoing.map((f) => (
              <li key={f.id}>
                {f.name}{' '}
                <button
                  type="button"
                  class="small ghost"
                  onClick={() => void act(() => api.removeFriend(f.id))}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The quest step text: the zone's, else the content's. */
export function questLine(q: { id: string; step: number; done: boolean; text: string | null }): {
  name: string;
  text: string;
} {
  const def = worldIndex.value?.quests.get(q.id);
  const name = def?.name ?? zoneName(q.id);
  const text = q.done ? 'Complete' : (q.text ?? def?.steps[q.step]?.text ?? '');
  return { name, text };
}

export function QuestsPanel({ c }: { c: WorldController }) {
  const quests = [...c.quests.value].sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <section class="world-quests" aria-label="Quests">
      {quests.length === 0 && (
        <p class="muted">No quests yet. Talk to people in town to find some.</p>
      )}
      <ul class="quest-list">
        {quests.map((q) => {
          const { name, text } = questLine(q);
          return (
            <li key={q.id} class={q.done ? 'done' : ''}>
              <span aria-hidden="true">{q.done ? '✔' : '◆'}</span> <strong>{name}</strong>
              <br />
              <span class="small-text">{text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WorldSettingsPanel({ c }: { c: WorldController }) {
  const acc = account.value;
  const adult = acc.kind === 'signed_in' ? acc.me.adult : false;
  const filter = c.filterChat.value;
  const s = settings.value;
  return (
    <section class="world-settings" aria-label="World settings">
      <h4>Chat</h4>
      {adult ? (
        <label class="check">
          <input
            type="checkbox"
            checked={filter === true}
            onChange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              c.setFilterChat(on);
              savePrefs({ filterChat: on });
            }}
          />{' '}
          Filter chat for me
        </label>
      ) : (
        <label class="check">
          <input type="checkbox" checked disabled /> Filter chat (always on for players under 18)
        </label>
      )}
      <p class="muted small-text">
        A conversation with anyone under 18 in it is always filtered for everyone in it.
      </p>
      <h4>Battle hints</h4>
      <label class="check">
        <input
          type="checkbox"
          checked={s.moveHighlights}
          onChange={(e) =>
            updateSettings({ moveHighlights: (e.target as HTMLInputElement).checked })
          }
        />{' '}
        Highlight legal moves
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={s.attackHints}
          onChange={(e) => updateSettings({ attackHints: (e.target as HTMLInputElement).checked })}
        />{' '}
        "This square is attacked" hints
      </label>
      <p class="muted small-text">Both stay on for new players until you turn them off.</p>
      <h4>Safety</h4>
      <SafetyPanel />
    </section>
  );
}
