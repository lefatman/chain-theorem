/** Promise wrapper around the NPC Web Worker, with an in-thread fallback (tests, no-worker envs). */
import { engine } from '@chain-theorem/content';
import { chooseOption, search, type Tier } from '@chain-theorem/ai';
import type { ChoiceRequest, Loadout, Move, PublicState } from '@chain-theorem/rules';
import type { NpcRequest, NpcResponse } from './npc.worker.ts';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: NpcResponse) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./npc.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<NpcResponse>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
    return worker;
  } catch {
    return null;
  }
}

type NpcCall = NpcRequest extends infer R ? (R extends NpcRequest ? Omit<R, 'id'> : never) : never;

function call(req: NpcCall): Promise<NpcResponse> {
  const w = getWorker();
  const id = nextId++;
  if (!w) {
    // Fallback: search on this thread.
    if (req.kind === 'move') {
      const r = search(engine, req.pub, req.own, req.tier, {
        ms: req.ms,
        now: () => performance.now(),
      });
      return Promise.resolve({ id, move: r.move });
    }
    return Promise.resolve({
      id,
      option: chooseOption(engine, req.pub, req.own, req.request, req.tier),
    });
  }
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ ...req, id } as NpcRequest);
  });
}

export async function npcMove(pub: PublicState, own: Loadout, tier: Tier, ms = 50): Promise<Move> {
  const r = await call({ kind: 'move', pub, own, tier, ms });
  if (!r.move) throw new Error(r.error ?? 'NPC found no move');
  return r.move as Move;
}

export async function npcOption(
  pub: PublicState,
  own: Loadout,
  tier: Tier,
  request: ChoiceRequest,
): Promise<number> {
  const r = await call({ kind: 'option', pub, own, tier, request });
  return r.option ?? request.defaultOption;
}
