import { engine } from '@chain-theorem/content';
import { moveToUci, type BattleEvent, type Side } from '@chain-theorem/rules';
import { chooseOption, search } from '@chain-theorem/ai';
import { cardLoadouts } from '../src/sim/builds.ts';
const seed = Number(process.argv[2] ?? 1);
const { withCard, without } = cardLoadouts('electric_slide', 'storm');
const aWhite = (seed - 1) % 2 === 0;
const g = { white: { loadout: aWhite ? withCard : without, level: 25, tier: 'trainer' as const }, black: { loadout: aWhite ? without : withCard, level: 25, tier: 'trainer' as const } };
let { state } = engine.newBattle({ format: 'first_blood', white: g.white, black: g.black, strict: true });
let plies = 0; const line: string[] = [];
while (!state.result && plies < 40) {
  const side: Side = state.turn; const me = g[side];
  const res = search(engine, engine.project(state, side), me.loadout, me.tier, { nodes: 20000, seed: seed * 1000 + plies });
  let r = engine.applyAction(state, { kind: 'move', side, move: res.move });
  const ev: BattleEvent[] = [...r.events];
  while (r.kind === 'needsChoice') { const req = r.request; const ch = g[req.chooser]; r = engine.applyAction(r.state, { kind: 'choice', side: req.chooser, promptId: req.promptId, option: chooseOption(engine, engine.project(r.state, req.chooser), ch.loadout, req, ch.tier) }); ev.push(...r.events); }
  const cap = ev.find((e) => e.k === 'Captured');
  line.push(moveToUci(res.move) + (cap ? `x${cap.victimType[0]}` : ''));
  state = r.state; plies++;
}
console.log(`seed ${seed}: Storm card is ${aWhite ? 'white' : 'black'} ->`, state.result?.winner, state.result?.reason, 'plies', plies, '|', line.join(' '));
