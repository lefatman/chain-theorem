/**
 * `pnpm test:firstwin` (M5 done-when, 10.3): a brand-new account goes from sign-up to its first battle
 * win through the real Worker (`wrangler dev`), on the path a new player who does not know chess
 * follows: accept the Headmaster's quest, walk to the tutors, solve every chess puzzle (no skipping),
 * then win Tutor Juno's first ability lesson battle. The bot plays with the NPC search from
 * `@chain-theorem/ai` using only what its client sees (public state and its own loadout).
 *
 * The bot is much faster than a person, so the tool also adds up a human time model for the same path
 * and fails when it exceeds 30 minutes: 90 s to sign up, 3 steps a second, 10 s per dialog, 45 s per
 * puzzle, 30 s to read a lesson intro, 15 s per own battle move and 2 s per NPC move.
 */
import { search, chooseOption } from '@chain-theorem/ai';
import { engine } from '@chain-theorem/content';
import {
  lessonById,
  npcLocation,
  stepFrom,
  walkable,
  zoneGeometry,
  type Dir,
  type ZoneGeometry,
} from '@chain-theorem/content/world';
import {
  moveToUci,
  type ChoiceRequest,
  type Loadout,
  type PublicState,
  type Side,
} from '@chain-theorem/rules';
import { signUp, startWorker, type LocalWorker } from '../lib/worker.ts';

const HUMAN = {
  signUpS: 90,
  stepsPerS: 3,
  dialogS: 10,
  puzzleS: 45,
  introS: 30,
  ownMoveS: 15,
  npcMoveS: 2,
  budgetS: 30 * 60,
} as const;
/** Lesson battles to try in order until one is won (each is deterministic: the player is White). */
const BATTLE_LESSONS = [
  ['tutor_juno', 'ability_hit_and_run'],
  ['tutor_juno', 'ability_scout'],
  ['tutor_juno', 'ability_poisoned_meat'],
] as const;
const PUZZLE_LESSONS = [
  ['tutor_nell', 'moves_basics'],
  ['tutor_rafe', 'check_basics'],
  ['tutor_rafe', 'checkmate_basics'],
] as const;

interface Frame {
  t: string;
  d: Record<string, unknown>;
}

const OPPOSITE: Record<Dir, Dir> = { n: 's', s: 'n', e: 'w', w: 'e' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Conn {
  readonly msgs: Frame[] = [];
  private seq = 0;
  private readonly ws: WebSocket;
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => this.msgs.push(JSON.parse(String(ev.data)) as Frame);
  }
  static async open(url: string): Promise<Conn> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`socket failed: ${url}`));
    });
    return new Conn(ws);
  }
  send(t: string, d: unknown = {}): void {
    this.ws.send(JSON.stringify({ t, s: this.seq++, d }));
  }
  /** Non-step zone messages share 5 per second (R-SEC-005): pace them like a (fast) person. */
  async act(t: string, d: unknown = {}): Promise<void> {
    await sleep(250);
    this.send(t, d);
  }
  async wait(pred: (m: Frame) => boolean, from = 0, ms = 20_000): Promise<Frame> {
    const until = Date.now() + ms;
    for (;;) {
      const m = this.msgs.slice(from).find(pred);
      if (m) return m;
      if (Date.now() > until)
        throw new Error(
          `timed out; last: ${this.msgs
            .slice(-5)
            .map((x) => `${x.t} ${JSON.stringify(x.d).slice(0, 160)}`)
            .join(' | ')}`,
        );
      await sleep(10);
    }
  }
  close(): void {
    this.ws.close(1000);
  }
}

/** Shortest path over walkable, non-grass, non-warp tiles (BFS); the directions to walk. */
function path(
  g: ZoneGeometry,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Dir[] {
  const key = (x: number, y: number) => y * g.width + x;
  const warps = new Set(g.warps.map((w) => key(w.x, w.y)));
  const prev = new Map<number, { k: number; d: Dir }>();
  const start = key(from.x, from.y);
  const goal = key(to.x, to.y);
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const k = queue.shift() as number;
    if (k === goal) break;
    const x = k % g.width;
    const y = Math.floor(k / g.width);
    for (const d of ['n', 's', 'e', 'w'] as const) {
      const n = stepFrom(x, y, d);
      const nk = key(n.x, n.y);
      if (seen.has(nk) || !walkable(g, n.x, n.y) || g.wild[nk] || (warps.has(nk) && nk !== goal))
        continue;
      seen.add(nk);
      prev.set(nk, { k, d });
      queue.push(nk);
    }
  }
  if (!seen.has(goal)) throw new Error(`no path to ${to.x},${to.y}`);
  const dirs: Dir[] = [];
  for (let k = goal; k !== start;) {
    const p = prev.get(k);
    if (!p) break;
    dirs.unshift(p.d);
    k = p.k;
  }
  return dirs;
}

/** The walkable tile next to an NPC closest to `from`, and the direction facing the NPC. */
function spotBeside(npc: string, zone: string, from: { x: number; y: number }) {
  const at = npcLocation(npc);
  if (!at || at.zone !== zone) throw new Error(`${npc} is not in ${zone}`);
  const g = zoneGeometry(zone);
  let best: { x: number; y: number; face: Dir; steps: Dir[] } | null = null;
  for (const d of ['s', 'n', 'e', 'w'] as const) {
    const t = stepFrom(at.x, at.y, d);
    if (!walkable(g, t.x, t.y)) continue;
    try {
      const steps = path(g, from, t);
      if (!best || steps.length < best.steps.length) best = { ...t, face: OPPOSITE[d], steps };
    } catch {
      /* unreachable side */
    }
  }
  if (!best) throw new Error(`cannot reach ${npc}`);
  return best;
}

interface Tally {
  steps: number;
  dialogs: number;
  puzzles: number;
  intros: number;
  ownMoves: number;
  npcMoves: number;
}

async function main(): Promise<void> {
  const wall = Date.now();
  const tally: Tally = { steps: 0, dialogs: 0, puzzles: 0, intros: 0, ownMoves: 0, npcMoves: 0 };
  const w: LocalWorker = await startWorker();
  let ok = false;
  try {
    const stamp = Date.now();
    const acc = await signUp(w, `newcomer-${stamp}@firstwin.test`, `Newcomer ${stamp % 100000}`);
    const ticket = (await (
      await fetch(`${w.origin}/api/world/ticket`, {
        method: 'POST',
        headers: { cookie: acc.cookie },
      })
    ).json()) as { zone: string; url: string };
    const zone = ticket.zone;
    const z = await Conn.open(`${w.origin.replace('http', 'ws')}${ticket.url}`);
    z.send('hello');
    const snap = (await z.wait((m) => m.t === 'zsnap')).d as { you: { x: number; y: number } };
    const pos = { x: snap.you.x, y: snap.you.y };
    console.log(`firstwin: signed up and entered ${zone} at ${pos.x},${pos.y}`);

    /** Walk next to the NPC, face it, talk; then pick `option` from the dialog. */
    const visit = async (npc: string, option: string): Promise<number> => {
      const spot = spotBeside(npc, zone, pos);
      for (const d of spot.steps) {
        z.send('step', { dir: d });
        tally.steps++;
        await sleep(135);
      }
      Object.assign(pos, { x: spot.x, y: spot.y });
      z.send('step', { dir: spot.face });
      await sleep(135);
      let from = z.msgs.length;
      await z.act('interact', { npc });
      const dialog = await z.wait((m) => m.t === 'dialog' || m.t === 'err', from);
      if (dialog.t === 'err') throw new Error(`${npc}: ${JSON.stringify(dialog.d)}`);
      tally.dialogs++;
      const options = (dialog.d.options as { id: string }[]).map((o) => o.id);
      if (!options.includes(option)) throw new Error(`${npc} offers ${options.join(', ')}`);
      from = z.msgs.length;
      await z.act('choose', { npc, option });
      return from;
    };

    // 1. The Headmaster's quest.
    const q = await visit('headmaster_orla', 'quest:academy_enrolment');
    await z.wait((m) => m.t === 'quest', q);
    console.log('firstwin: accepted the Academy quest');

    // 2. Every chess puzzle, as a new player would.
    for (const [npc, id] of PUZZLE_LESSONS) {
      const lesson = lessonById.get(id);
      if (lesson?.kind !== 'puzzles') throw new Error(`${id} is not a puzzle lesson`);
      const from = await visit(npc, `lesson:${id}`);
      tally.intros++;
      await z.wait((m) => m.t === 'puzzle', from);
      for (const [i, p] of lesson.puzzles.entries()) {
        const f = z.msgs.length;
        await z.act('answer', { lesson: id, puzzle: i, move: p.accept[0] });
        const r = await z.wait((m) => m.t === 'lessonResult', f);
        if (r.d.ok !== true) throw new Error(`${id} puzzle ${i} refused`);
        tally.puzzles++;
      }
      console.log(`firstwin: solved ${lesson.puzzles.length} puzzles of ${id}`);
    }

    // 3. Ability lesson battles until the first win.
    for (const [npc, id] of BATTLE_LESSONS) {
      const lesson = lessonById.get(id);
      if (lesson?.kind !== 'battle') throw new Error(`${id} is not a battle lesson`);
      const from = await visit(npc, `lesson:${id}`);
      tally.intros++;
      const enc = await z.wait((m) => m.t === 'enc', from);
      const won = await playBattle(
        `${w.origin.replace('http', 'ws')}${String(enc.d.url)}`,
        lesson.player.loadout,
        tally,
      );
      await z.wait((m) => m.t === 'zbattle' && m.d.p === acc.id && m.d.battling === false, from);
      console.log(`firstwin: ${id}: ${won ? 'won' : 'lost'}`);
      if (!won) continue;
      await z.wait((m) => m.t === 'reward', from);
      const progress = (await (
        await fetch(`${w.origin}/api/progress`, { headers: { cookie: acc.cookie } })
      ).json()) as { level: number; lessonsDone: string[]; quests: { id: string; step: number }[] };
      if (!progress.lessonsDone.includes(id)) throw new Error('the win was not recorded');
      const human =
        HUMAN.signUpS +
        tally.steps / HUMAN.stepsPerS +
        tally.dialogs * HUMAN.dialogS +
        tally.puzzles * HUMAN.puzzleS +
        tally.intros * HUMAN.introS +
        tally.ownMoves * HUMAN.ownMoveS +
        tally.npcMoves * HUMAN.npcMoveS;
      console.log(
        JSON.stringify(
          {
            firstWin: id,
            level: progress.level,
            quests: progress.quests,
            tally,
            humanEstimateMinutes: +(human / 60).toFixed(1),
            budgetMinutes: HUMAN.budgetS / 60,
            botWallSeconds: +((Date.now() - wall) / 1000).toFixed(1),
          },
          null,
          2,
        ),
      );
      ok = human <= HUMAN.budgetS;
      console.log(
        ok
          ? `firstwin ok: sign-up to a first win in about ${(human / 60).toFixed(1)} minutes of human play (limit 30)`
          : `firstwin FAILED: about ${(human / 60).toFixed(1)} minutes (limit 30)`,
      );
      break;
    }
    if (!ok && tally.ownMoves === 0) console.log('firstwin FAILED: no battle was played');
    z.close();
  } finally {
    await w.stop();
  }
  process.exitCode = ok ? 0 : 1;
}

/** Play one battle as its client would; true when this side won. */
async function playBattle(url: string, own: Loadout, tally: Tally): Promise<boolean> {
  const b = await Conn.open(url);
  b.send('hello', { from: 0 });
  const start = (await b.wait((m) => m.t === 'bstart')).d;
  const you = start.you as Side;
  let pub = start.public as unknown as PublicState;
  let seen = 0;
  let movedAt = -1;
  const answered = new Set<string>();
  for (;;) {
    const fresh = b.msgs.slice(seen);
    seen = b.msgs.length;
    for (const m of fresh) {
      if (m.t === 'bev') {
        pub = m.d.public as unknown as PublicState;
        const events = m.d.events as { k: string; side?: Side }[];
        tally.npcMoves += events.filter((e) => e.k === 'ActionStarted' && e.side !== you).length;
      } else if (m.t === 'prompt') {
        const req = m.d.request as unknown as ChoiceRequest;
        if (!answered.has(req.promptId)) {
          answered.add(req.promptId);
          b.send('ch', { promptId: req.promptId, option: chooseOption(engine, pub, own, req) });
        }
      } else if (m.t === 'bend') {
        b.close();
        const result = m.d.result as { winner: Side | null };
        return result.winner === you;
      }
    }
    if (pub.turn === you && !pub.pending && pub.legal.length > 0 && movedAt !== pub.ply) {
      const best = moveToUci(search(engine, pub, own, 'elite', { nodes: 60_000 }).move);
      const uci = pub.legal.includes(best) ? best : pub.legal[0];
      b.send('mv', { move: uci });
      movedAt = pub.ply;
      tally.ownMoves++;
    }
    await sleep(10);
  }
}

await main();
