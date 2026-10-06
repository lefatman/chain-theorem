/**
 * Mid-action choice prompt (5.4). Optional bonus actions list Decline first and it is the default
 * (DD-18). When the controller sets a deadline (online play: 15 s charged to the chooser's clock),
 * a countdown shows the time left and which option is used if it runs out. The option squares are
 * also highlighted on the board and can be clicked there (BattleView).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { CHOICE_PROMPT_MS } from '@chain-theorem/content';
import {
  compassFrom,
  squareName,
  type ChoiceOption,
  type ChoiceRequest,
  type PublicState,
} from '@chain-theorem/rules';
import type { BattleController } from '../battle/controller.ts';
import { COMPASS_NAMES, abilityName, pieceLabel } from '../battle/describe.ts';
import { nowFor } from './Clocks.tsx';

export function optionLabel(
  pub: PublicState,
  o: ChoiceOption,
  req?: Pick<ChoiceRequest, 'purpose' | 'subject' | 'source'>,
): string {
  const facing = req?.purpose === 'facing';
  switch (o.kind) {
    case 'decline':
      return facing ? 'Keep the current facing' : 'Decline';
    case 'piece':
      return (pub.pieces[o.piece]?.square ?? 0) < 0
        ? `${pieceLabel(pub, o.piece)} (captured) back to ${squareName(o.square)}`
        : `${pieceLabel(pub, o.piece)} on ${squareName(o.square)}`;
    case 'square': {
      if (facing && req) {
        // Block Path (DD-99): the square names the direction the piece will face.
        const at = pub.pieces[req.subject ?? req.source.piece]?.square ?? -1;
        const dir = at >= 0 ? compassFrom(at, o.square) : null;
        if (dir) return `Face ${COMPASS_NAMES[dir]} (${squareName(o.square)})`;
      }
      return squareName(o.square);
    }
    case 'move':
      return `${squareName(o.from)} → ${squareName(o.to)}${o.promotion ? ` (${o.promotion})` : ''}`;
  }
}

/** The board square an option points at, for highlights and board clicks. */
export function optionSquare(o: ChoiceOption): number | null {
  switch (o.kind) {
    case 'piece':
    case 'square':
      return o.square;
    case 'move':
      return o.to;
    default:
      return null;
  }
}

const KIND_TEXT = {
  bonusMove: 'You may make a bonus move, or decline it.',
  square: 'Choose a square.',
  target: 'Choose a target.',
} as const;

function promptText(p: ChoiceRequest): string {
  if (p.purpose === 'facing')
    return 'Turn it to face a direction: no move can capture it from there. Or keep its facing.';
  return KIND_TEXT[p.kind];
}

export function PromptDialog({
  controller,
  onFocusOption,
}: {
  controller: BattleController;
  onFocusOption(square: number | null): void;
}) {
  const s = controller.snapshot.value;
  const p = s.prompt;
  const first = useRef<HTMLButtonElement>(null);
  const [, tick] = useState(0);
  const deadline = p?.deadline;

  useEffect(() => {
    // A required choice: move keyboard focus to it so it can be answered straight away.
    first.current?.focus();
  }, [p?.promptId]);

  useEffect(() => {
    if (deadline === undefined) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [deadline]);

  if (!p) return null;
  const left = deadline === undefined ? null : Math.max(0, deadline - nowFor(deadline));
  const secs = left === null ? null : Math.ceil(left / 1000);
  const total = Math.max(CHOICE_PROMPT_MS, left ?? 0);
  const defaultOpt = p.options[p.defaultOption];
  return (
    <section class="prompt" role="dialog" aria-labelledby="prompt-h" aria-describedby="prompt-d">
      <h3 id="prompt-h">
        <span aria-hidden="true">{'❓︎'} </span>
        {abilityName(p.source.ability)}: your choice
      </h3>
      <p id="prompt-d">
        {pieceLabel(s.pub, p.source.piece)}. {promptText(p)}
      </p>
      {secs !== null && left !== null && (
        <div class={`countdown ${secs <= 5 ? 'low' : ''}`}>
          <span role="timer" aria-live="off">
            <span aria-hidden="true">{'⏱︎'} </span>
            {secs} s left
          </span>
          <progress max={total} value={left} aria-hidden="true" />
          <span class="muted">
            {secs === 0 ? 'Time is up: ' : 'Then: '}
            {defaultOpt ? optionLabel(s.pub, defaultOpt, p) : 'the first option'}
          </span>
          <span class="sr-only" aria-live="assertive">
            {secs === 10 || secs === 5 ? `${secs} seconds left` : ''}
          </span>
        </div>
      )}
      <div class="prompt-options">
        {p.options.map((o, i) => (
          <button
            key={i}
            ref={i === 0 ? first : undefined}
            class={i === p.defaultOption ? 'default' : ''}
            onClick={() => controller.answer(i)}
            onMouseEnter={() => onFocusOption(optionSquare(o))}
            onFocus={() => onFocusOption(optionSquare(o))}
            onMouseLeave={() => onFocusOption(null)}
          >
            {optionLabel(s.pub, o, p)}
            {i === p.defaultOption && <span class="muted"> (default)</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
