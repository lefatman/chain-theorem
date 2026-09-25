/**
 * `pnpm tournament:local` (M7 done-when, spec 16: "the first public tournament completes", run
 * locally with test accounts). Starts the real Worker (`wrangler dev`: local D1, R2 and Durable
 * Objects), signs up 8 accounts through the magic-link flow, makes the first one an admin
 * (`ADMIN_EMAILS`), creates a tournament that starts in a few seconds with a short break between
 * rounds, registers everyone, and plays every game with bot clients that pick moves with
 * `@chain-theorem/ai` `search` on their own public state (what the client sees, R-SEC-001) until the
 * TournamentRoom finishes the event. Each bot saves its own legal loadout from the starter collection
 * and searches with its own budget, so the games differ. Prints the final standings and exits 0 only when a winner is
 * recorded and every prize was granted exactly once (R-SEC-003, the reward grant keys).
 *
 * Options: `--format swiss|se` (default swiss), `--players N` (default 8), `--game first_blood|
 * vanguard|full` (default vanguard: real games in about half a minute), `--nodes N` (search budget
 * per move).
 */
import { readFileSync } from 'node:fs';
import { chooseOption, search } from '@chain-theorem/ai';
import { engine } from '@chain-theorem/content';
import type { BattleTicket, TournamentView } from '@chain-theorem/protocol';
import {
  moveToUci,
  type ChoiceRequest,
  type Loadout,
  type PublicState,
  type Side,
} from '@chain-theorem/rules';
import { signUp, startWorker, type LocalWorker } from '../lib/worker.ts';

interface Frame {
  t: string;
  d: Record<string, unknown>;
}

interface Account {
  name: string;
  email: string;
  cookie: string;
  id: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const SYSTEM = arg('format', 'swiss') === 'se' ? 'se' : 'swiss';
const PLAYERS = Math.max(2, Math.min(64, Number(arg('players', '8')) || 8));
const GAME = arg('game', 'vanguard');
const NODES = Math.max(1000, Number(arg('nodes', '20000')) || 20000);

async function api<T>(
  w: LocalWorker,
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${w.origin}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

/**
 * Play one battle as its client would, with the NPC search on the bot's own projection. Resolves
 * null when the socket closed before the end (a reload of the local Worker, a dropped connection):
 * the caller reconnects with a fresh ticket, as the app does. A move the server refuses is not sent
 * again in that position.
 */
async function playBattle(
  url: string,
  nodes: number,
): Promise<{ you: Side; winner: Side | null; plies: number } | null> {
  const ws = new WebSocket(url);
  const msgs: Frame[] = [];
  let closed = false;
  ws.onmessage = (ev) => msgs.push(JSON.parse(String(ev.data)) as Frame);
  const opened = await new Promise<boolean>((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
  });
  if (!opened) return null;
  ws.onclose = () => {
    closed = true;
  };
  let seq = 0;
  const send = (t: string, d: unknown = {}) => ws.send(JSON.stringify({ t, s: seq++, d }));
  send('hello', { from: 0 });
  let you: Side | null = null;
  let pub: PublicState | null = null;
  let own: Loadout | null = null;
  let seen = 0;
  let movedAt = -1;
  let sent: string | null = null;
  const refused = new Map<number, Set<string>>();
  const answered = new Set<string>();
  const deadline = Date.now() + 30 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('battle took too long');
    const fresh = msgs.slice(seen);
    seen = msgs.length;
    for (const m of fresh) {
      if (m.t === 'bstart') {
        you = m.d.you as Side;
        pub = m.d.public as unknown as PublicState;
        own = pub.armies[you].loadout ?? null;
      } else if (m.t === 'bev') pub = m.d.public as unknown as PublicState;
      else if (m.t === 'prompt' && pub && own) {
        const req = m.d.request as unknown as ChoiceRequest;
        if (!answered.has(req.promptId)) {
          answered.add(req.promptId);
          send('ch', { promptId: req.promptId, option: chooseOption(engine, pub, own, req) });
        }
      } else if (m.t === 'err' && pub && sent !== null && movedAt === pub.ply) {
        // The move was refused: remember it for this position and choose again.
        const set = refused.get(pub.ply) ?? new Set<string>();
        set.add(sent);
        refused.set(pub.ply, set);
        movedAt = -1;
      } else if (m.t === 'bend') {
        ws.close(1000);
        const result = m.d.result as { winner: Side | null };
        return { you: you ?? 'white', winner: result.winner, plies: pub?.ply ?? 0 };
      }
    }
    if (closed) return null;
    if (pub && own && you && pub.turn === you && !pub.pending && pub.legal.length > 0) {
      if (movedAt !== pub.ply) {
        const bad = refused.get(pub.ply) ?? new Set<string>();
        const options = pub.legal.filter((u) => !bad.has(u));
        const best = moveToUci(search(engine, pub, own, 'elite', { nodes }).move);
        sent = options.includes(best) ? best : (options[0] ?? pub.legal[0] ?? '');
        send('mv', { move: sent });
        movedAt = pub.ply;
      }
    }
    await sleep(10);
  }
}

/**
 * Each bot's own loadout from the starter collection (Dual Adept's Glove, Hit and Run, Last Word,
 * Scout): an element and an ability pair by index, so games differ; checked legal at level 1.
 */
function botLoadout(i: number): Loadout | null {
  const elements = engine.caps.ENABLED_ELEMENTS;
  const pairs = [
    ['hit_and_run', 'scout'],
    ['last_word', 'scout'],
    ['hit_and_run', 'last_word'],
  ];
  const loadout: Loadout = {
    elements: [elements[i % elements.length] ?? 'ember'],
    items: ['dual_adepts_glove'],
    sets: [pairs[i % pairs.length] ?? []],
  };
  return engine.validateLoadout(loadout, { level: 1 }).ok ? loadout : null;
}

/** A bot: polls the tournament page and plays each game of its own as soon as it is ready. */
async function bot(
  w: LocalWorker,
  a: Account,
  id: string,
  nodes: number,
  log: (s: string) => void,
) {
  const played = new Set<string>();
  let failures = 0;
  for (;;) {
    const v = await api<TournamentView>(w, 'GET', `/api/tournaments/${id}`, a.cookie).catch(() => ({
      status: 0,
      data: null as unknown as TournamentView,
    }));
    if (v.status !== 200) {
      // A transient failure (the local Worker restarting) is retried; a persistent one is not.
      if (++failures > 40) throw new Error(`${a.name}: view ${v.status}`);
      await sleep(500);
      continue;
    }
    failures = 0;
    if (v.data.status === 'finished' || v.data.status === 'cancelled') return;
    const game = v.data.you.game;
    if (game && !played.has(game.battleId)) {
      played.add(game.battleId);
      const t = await api<BattleTicket>(w, 'POST', `/api/tournaments/${id}/ticket`, a.cookie);
      const r =
        t.status === 200
          ? await playBattle(`${w.origin.replace('http', 'ws')}${t.data.url}`, nodes)
          : null;
      if (!r) {
        // Not over yet: reconnect with a fresh ticket while the game is still ours.
        played.delete(game.battleId);
        await sleep(500);
        continue;
      }
      const outcome = r.winner === null ? 'drew' : r.winner === r.you ? 'won' : 'lost';
      log(
        `round ${game.round}: ${a.name} ${outcome} as ${r.you} against ${game.opponent} (${r.plies} plies)`,
      );
      continue;
    }
    await sleep(250);
  }
}

function standingsTable(v: TournamentView): string {
  const rows = v.standings.map((s) =>
    v.system === 'swiss'
      ? `${String(s.rank).padStart(3)}  ${s.name.padEnd(12)} ${String(s.points).padStart(4)}  ${String(s.buchholz).padStart(5)}  ${String(s.sb).padStart(5)}  ${s.wins}/${s.games}`
      : `${String(s.rank).padStart(3)}  ${s.name.padEnd(12)} ${String(s.points).padStart(4)}  seed ${s.seed}`,
  );
  const head =
    v.system === 'swiss'
      ? '  #  player         pts  buchh     SB  won/played'
      : '  #  player      rounds  seed';
  return [head, ...rows].join('\n');
}

async function main(): Promise<void> {
  const wall = Date.now();
  const stamp = Date.now();
  const adminEmail = `admin-${stamp}@tournament.test`;
  const w = await startWorker({ vars: { ADMIN_EMAILS: adminEmail } });
  let ok = false;
  try {
    const accounts: Account[] = [];
    for (let i = 0; i < PLAYERS; i++) {
      const name = i === 0 ? 'Admin' : `Bot ${i}`;
      const email = i === 0 ? adminEmail : `bot${i}-${stamp}@tournament.test`;
      const s = await signUp(w, email, name);
      accounts.push({ name, email, ...s });
      const loadout = botLoadout(i);
      if (loadout) {
        const saved = await api<{ valid: boolean }>(w, 'PUT', '/api/loadouts', s.cookie, {
          name: 'Tournament',
          loadout,
        });
        if (saved.status !== 200 || !saved.data.valid) throw new Error(`${name}: loadout refused`);
      }
    }
    const admin = accounts[0] as Account;
    console.log(`tournament: signed up ${accounts.length} accounts (admin ${admin.email})`);

    const created = await api<{ tournament: { id: string; name: string; startsAt: number } }>(
      w,
      'POST',
      '/api/admin/tournaments',
      admin.cookie,
      {
        name: `Local ${SYSTEM === 'swiss' ? 'Swiss' : 'Knockout'} ${stamp % 10000}`,
        format: GAME,
        bracket: '1-2',
        system: SYSTEM,
        startInMs: 5000,
        breakMs: 1000,
        maxPlayers: PLAYERS,
      },
    );
    if (created.status !== 200)
      throw new Error(`create: ${created.status} ${JSON.stringify(created.data)}`);
    const t = created.data.tournament;
    console.log(`tournament: created "${t.name}" (${SYSTEM}, ${GAME}), starting in 5 s`);
    for (const a of accounts) {
      const r = await api<TournamentView>(w, 'POST', `/api/tournaments/${t.id}/register`, a.cookie);
      if (r.status !== 200)
        throw new Error(`${a.name}: register ${r.status} ${JSON.stringify(r.data)}`);
    }
    console.log(`tournament: ${accounts.length} registered`);

    const log = (s: string) => console.log(`tournament: ${s}`);
    // Different strengths too: a quarter to the full search budget.
    await Promise.all(
      accounts.map((a, i) => bot(w, a, t.id, Math.round((NODES * (1 + (i % 4))) / 4), log)),
    );

    const end = (await api<TournamentView>(w, 'GET', `/api/tournaments/${t.id}`, admin.cookie))
      .data;
    console.log(
      `\n${end.name}: ${end.status}, ${end.rounds} rounds, ${end.players} players, winner ${end.winner?.name ?? 'none'}\n`,
    );
    console.log(standingsTable(end));

    // Prizes: every top place with points got exactly one grant under tournament:<id>:<player>.
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const due = end.standings.filter(
      (s) => end.prizes.some((p) => p.place === s.rank) && (s.points > 0 || s.games > s.forfeits),
    );
    // The room writes the end right after the last result; give it a moment.
    await sleep(1500);
    let granted = 0;
    for (const s of due) {
      const a = byId.get(s.id);
      if (!a) continue;
      const exp = await api<{
        rewardGrants: { key: string }[];
        tournaments: { place: number | null }[];
      }>(w, 'GET', '/api/me/export', a.cookie);
      const keys = exp.data.rewardGrants.filter((g) => g.key === `tournament:${t.id}:${s.id}`);
      console.log(`tournament: prize for place ${s.rank} (${s.name}): ${keys.length} grant(s)`);
      if (keys.length === 1) granted++;
    }
    const list = await api<{ finished: { id: string; winner: { id: string } | null }[] }>(
      w,
      'GET',
      '/api/tournaments',
      admin.cookie,
    );
    const listed = list.data.finished.find((x) => x.id === t.id);
    ok =
      end.status === 'finished' &&
      end.winner !== null &&
      listed?.winner?.id === end.winner.id &&
      due.length > 0 &&
      granted === due.length;
    console.log(
      ok
        ? `\ntournament ok: ${end.winner?.name} won; ${granted} prizes granted once each; ${((Date.now() - wall) / 1000).toFixed(0)} s`
        : `\ntournament FAILED: status ${end.status}, winner ${end.winner?.name ?? 'none'}, prizes ${granted}/${due.length}`,
    );
  } catch (err) {
    console.error(`tournament FAILED: ${String(err)}`);
  } finally {
    if (!ok) {
      // The Worker's own console (errors included) is the best clue; it is deleted with the Worker.
      const lines = readFileSync(w.log, 'utf8').split('\n');
      console.error(`--- worker log (last 80 lines) ---\n${lines.slice(-80).join('\n')}`);
    }
    await w.stop();
  }
  process.exitCode = ok ? 0 : 1;
}

await main();
