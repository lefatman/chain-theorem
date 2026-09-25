/** Small text helpers for the Scenario Lab panels. */
import {
  squareName,
  uciToMove,
  type BattleEvent,
  type ChoiceOption,
  type PublicState,
  type Side,
} from '@chain-theorem/rules';
import { describe, pieceLabel } from '../battle/describe.ts';
import type { LabFrame } from './frames.ts';
import type { LabAction, LabSession } from './session.ts';

export const sideName = (s: Side): string => (s === 'white' ? 'White' : 'Black');

export function actionLabel(a: LabAction): string {
  if (a.kind === 'start' || !a.uci || !a.side) return 'Battle start';
  const m = uciToMove(a.uci);
  const promo = m.promotion ? ` (${m.promotion})` : '';
  return `${a.n}. ${sideName(a.side)} ${squareName(m.from)} → ${squareName(m.to)}${promo}`;
}

export function optionText(pub: PublicState, o: ChoiceOption): string {
  switch (o.kind) {
    case 'decline':
      return 'Decline';
    case 'piece':
      return `${pieceLabel(pub, o.piece)} on ${squareName(o.square)}`;
    case 'square':
      return squareName(o.square);
    case 'move':
      return `${squareName(o.from)} → ${squareName(o.to)}${o.promotion ? ` (${o.promotion})` : ''}`;
  }
}

/**
 * What each player's log would say for this event (R-INFO-005): the event projected for that viewer
 * with the reveal logs as of the end of the action, exactly as the battle UI builds its log.
 */
export function projectedLines(s: LabSession, f: LabFrame): Record<Side, string> {
  const line = (viewer: Side) => {
    const [ev] = s.engine.projectEvents(f.action.after, [f.event], viewer);
    return ev ? describe(ev, f.pub) : '';
  };
  return { white: line('white'), black: line('black') };
}

/** Short event label for the chain list, e.g. 'Captured' or 'Fizzled (no_body)'. */
export function eventTag(ev: BattleEvent): string {
  switch (ev.k) {
    case 'EffectFizzled':
      return `Fizzled (${ev.reason})`;
    case 'AbilityTriggered':
      return ev.attuned ? 'Triggered (attuned)' : 'Triggered';
    case 'AbilityNegated':
      return 'Negated';
    case 'AbilitySilenced':
      return 'Silenced';
    default:
      return ev.k;
  }
}

/** Pretty JSON for the debug views (2-space indent, stable). */
export function prettyJson(v: unknown): string {
  return JSON.stringify(v, null, 2) ?? 'undefined';
}
