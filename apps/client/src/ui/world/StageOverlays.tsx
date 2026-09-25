/**
 * Overlays on the world map (M5, spec 10.1–10.5): the challenge-zone banner (R-WORLD-006), the
 * quest tracker, reward toasts, incoming challenges and party invites, and the touch controls
 * (d-pad and action button for 360x640 phones, 12.3). Every colour cue has an icon or text.
 */
import { useEffect, useState } from 'preact/hooks';
import { FORMATS } from '@chain-theorem/content';
import { api } from '../../net/api.ts';
import { activeTrade, openTrade, tradeApiError } from '../../trade/session.ts';
import type { Dir } from '@chain-theorem/protocol';
import { worldIndex } from '../../world/content.ts';
import type { Toast, TradeInvite, WagerEnd, WorldController } from '../../world/controller.ts';
import type { InputDriver } from '../../world/input.ts';
import { rewardText } from '../../world/rewards.ts';
import { questLine } from './SocialPanels.tsx';
import { moduleName } from './TradeWindow.tsx';

const BANNER_MS = 6000;
const TOAST_MS = 7000;

export function ChallengeBanner({ c }: { c: WorldController }) {
  const b = c.banner.value;
  const inside = c.challengeZone.value;
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!b) return;
    setShown(b.at);
    const t = setTimeout(() => setShown(null), BANNER_MS);
    return () => clearTimeout(t);
  }, [b?.at]);
  const fresh = b !== null && shown === b.at;
  if (fresh && b)
    return (
      <div class={`world-banner ${b.inside ? 'inside' : ''}`} role="status" aria-live="assertive">
        <span aria-hidden="true">{b.inside ? '⚔' : '☮'}</span>{' '}
        {b.inside ? (
          <>
            <strong>Challenge zone.</strong> Being here means anyone nearby in your bracket can
            start a First Blood battle with you. Leave the zone to end consent.
          </>
        ) : (
          <>
            <strong>You left the challenge zone.</strong> Challenges need your consent again.
          </>
        )}
      </div>
    );
  if (inside)
    return (
      <div class="world-badge" role="status">
        <span aria-hidden="true">⚔</span> Challenge zone
      </div>
    );
  return null;
}

export function QuestTracker({ c }: { c: WorldController }) {
  const [open, setOpen] = useState(true);
  const active = c.quests.value.filter((q) => !q.done);
  void worldIndex.value;
  const q = active[0];
  if (!q) return null;
  const { name, text } = questLine(q);
  return (
    <div class="quest-tracker" aria-label="Quest tracker">
      <button type="button" class="small ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">◆</span> {name}
        {active.length > 1 ? ` (+${active.length - 1})` : ''}
      </button>
      {open && text && <p class="small-text">{text}</p>}
    </div>
  );
}

function ToastView({ t, c }: { t: Toast; c: WorldController }) {
  useEffect(() => {
    const timer = setTimeout(() => c.dismissToast(t.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [t.id]);
  let title: string;
  let lines: string[];
  if (t.kind === 'reward') {
    const r = rewardText(t.reward, (id) => worldIndex.value?.keyItems.get(id)?.name);
    title = r.title;
    lines = r.lines;
  } else {
    title = t.kind === 'error' ? 'Hmm.' : 'Note';
    lines = [t.text];
  }
  const icon =
    t.kind === 'reward' ? (t.reward.levelUp ? '▲' : '★') : t.kind === 'error' ? '!' : 'i';
  return (
    <li class={`toast ${t.kind} ${t.kind === 'reward' && t.reward.levelUp ? 'level' : ''}`}>
      <span class="toast-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <strong>{title}</strong>
        {lines.map((l, i) => (
          <div key={i} class="small-text">
            {l}
          </div>
        ))}
      </div>
      <button
        type="button"
        class="small ghost"
        aria-label="Dismiss"
        onClick={() => c.dismissToast(t.id)}
      >
        ×
      </button>
    </li>
  );
}

export function Toasts({ c }: { c: WorldController }) {
  const toasts = c.toasts.value;
  return (
    <ol class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} t={t} c={c} />
      ))}
    </ol>
  );
}

/** An invitation lapses on the server after 2 minutes (TradeCore INVITE_TTL_MS). */
const TRADE_INVITE_MS = 2 * 60_000;

/** A trade or wager invitation (M6, 10.4, 9.5): open the window, or decline. */
function TradePrompt({ x, c }: { x: TradeInvite; c: WorldController }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => c.dismissTrade(x.id), TRADE_INVITE_MS);
    return () => clearTimeout(t);
  }, [x.id]);
  const open = async () => {
    setBusy(true);
    try {
      openTrade(await api.tradeTicket(x.id));
      c.dismissTrade(x.id);
    } catch (e) {
      setNote(tradeApiError(e, x.name));
      setBusy(false);
    }
  };
  return (
    <div class="world-prompt">
      <span>
        <span aria-hidden="true">{x.mode === 'wager' ? '⚔' : '⇄'}</span> <strong>{x.name}</strong>{' '}
        {x.mode === 'wager' ? 'invites you to an item wager battle.' : 'wants to trade with you.'}
        {note && <span class="note warn small-text"> {note}</span>}
      </span>
      <span class="row">
        <button
          type="button"
          class="small primary"
          disabled={busy || activeTrade.value !== null}
          onClick={() => void open()}
        >
          {x.mode === 'wager' ? 'See the wager' : 'Open trade'}
        </button>
        <button
          type="button"
          class="small"
          onClick={() => {
            c.dismissTrade(x.id);
            void api.declineTrade(x.id).catch(() => undefined);
          }}
        >
          Decline
        </button>
      </span>
    </div>
  );
}

/** A settled wager (9.5): what this player received. */
function WagerResult({ x, c }: { x: WagerEnd; c: WorldController }) {
  const got = [
    ...x.items.map((i) => `${moduleName('items', i.id)} × ${i.qty}`),
    ...x.cards.map((i) => `${moduleName('cards', i.id)} × ${i.qty}`),
  ];
  const head =
    x.result === 'won'
      ? 'You won the wager.'
      : x.result === 'lost'
        ? 'You lost the wager: your stake went to the winner.'
        : x.result === 'draw'
          ? 'The wager battle was a draw: stakes returned.'
          : 'The wager battle did not start: stakes returned.';
  return (
    <div class="world-prompt">
      <span>
        <span aria-hidden="true">{x.result === 'won' ? '★' : '⚔'}</span> <strong>{head}</strong>
        {got.length > 0 && <span class="small-text"> You received {got.join(', ')}.</span>}
        {x.invalid.length > 0 && (
          <span class="note warn small-text">
            {' '}
            Loadout {x.invalid.map((n) => `“${n}”`).join(', ')} is invalid until you fix it.
          </span>
        )}
      </span>
      <button type="button" class="small" onClick={() => c.dismissTrade(x.id)}>
        OK
      </button>
    </div>
  );
}

export function Prompts({ c }: { c: WorldController }) {
  const chal = c.challenges.value;
  const inv = c.invites.value;
  const trades = c.tradeInvites.value;
  const wagers = c.wagerResults.value;
  if (chal.length === 0 && inv.length === 0 && trades.length === 0 && wagers.length === 0)
    return null;
  return (
    <div class="world-prompts" role="alert">
      {trades.map((x) => (
        <TradePrompt key={x.id} x={x} c={c} />
      ))}
      {wagers.map((x) => (
        <WagerResult key={x.id} x={x} c={c} />
      ))}
      {chal.map((x) => (
        <div key={x.id} class="world-prompt">
          <span>
            <span aria-hidden="true">⚔</span> <strong>{x.name}</strong> challenges you to{' '}
            {FORMATS[x.format]?.name ?? x.format}.
          </span>
          <span class="row">
            <button
              type="button"
              class="small primary"
              onClick={() => c.replyChallenge(x.id, true)}
            >
              Accept
            </button>
            <button type="button" class="small" onClick={() => c.replyChallenge(x.id, false)}>
              Decline
            </button>
          </span>
        </div>
      ))}
      {inv.map((x) => (
        <div key={x.id} class="world-prompt">
          <span>
            <span aria-hidden="true">✚</span> <strong>{x.name}</strong> invites you to a party.
          </span>
          <span class="row">
            <button type="button" class="small primary" onClick={() => c.replyInvite(x.id, true)}>
              Join
            </button>
            <button type="button" class="small" onClick={() => c.replyInvite(x.id, false)}>
              Decline
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

const PAD: { dir: Dir; label: string; glyph: string }[] = [
  { dir: 'n', label: 'Walk up', glyph: '▲' },
  { dir: 'w', label: 'Walk left', glyph: '◀' },
  { dir: 'e', label: 'Walk right', glyph: '▶' },
  { dir: 's', label: 'Walk down', glyph: '▼' },
];

/** On-screen d-pad and action button (touch, 360x640). Pointer capture keeps a held press. */
export function TouchControls({ input, onAction }: { input: InputDriver; onAction(): void }) {
  return (
    <div class="touch-controls">
      <div class="dpad" role="group" aria-label="Walk">
        {PAD.map((p) => (
          <button
            key={p.dir}
            type="button"
            class={`dpad-${p.dir}`}
            aria-label={p.label}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              input.press(p.dir);
            }}
            onPointerUp={() => input.release(p.dir)}
            onPointerCancel={() => input.release(p.dir)}
            onLostPointerCapture={() => input.release(p.dir)}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                input.press(p.dir);
                input.release(p.dir);
              }
            }}
          >
            {p.glyph}
          </button>
        ))}
      </div>
      <button
        type="button"
        class="action-btn"
        aria-label="Talk or interact"
        onPointerDown={(e) => {
          e.preventDefault();
          onAction();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onAction();
          }
        }}
      >
        A
      </button>
    </div>
  );
}
