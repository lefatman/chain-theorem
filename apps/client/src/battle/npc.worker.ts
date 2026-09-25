/// <reference lib="webworker" />
/**
 * NPC search off the main thread (local play, M3). Receives the NPC's own projection and loadout
 * only (9.4: NPCs never read hidden player data) and answers with a move or an option index.
 */
import { engine } from '@chain-theorem/content';
import { chooseOption, search, type Tier } from '@chain-theorem/ai';
import type { ChoiceRequest, Loadout, PublicState } from '@chain-theorem/rules';

export type NpcRequest =
  | { id: number; kind: 'move'; pub: PublicState; own: Loadout; tier: Tier; ms: number }
  | { id: number; kind: 'option'; pub: PublicState; own: Loadout; tier: Tier; request: ChoiceRequest };

export type NpcResponse = { id: number; move?: { from: number; to: number; promotion?: string }; option?: number; error?: string };

self.onmessage = (e: MessageEvent<NpcRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'move') {
      const r = search(engine, req.pub, req.own, req.tier, { ms: req.ms, now: () => performance.now() });
      (self as unknown as Worker).postMessage({ id: req.id, move: r.move } satisfies NpcResponse);
    } else {
      const option = chooseOption(engine, req.pub, req.own, req.request, req.tier);
      (self as unknown as Worker).postMessage({ id: req.id, option } satisfies NpcResponse);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) } satisfies NpcResponse);
  }
};
