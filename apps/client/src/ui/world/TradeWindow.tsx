/**
 * The trade and wager window (M6 6.1; spec 10.4 R-WORLD-004, 9.5 R-FMT-006). Each player builds their
 * own offer (or stake) from their collection and sees the other's; any change on either side resets
 * both players' marks, which the window says plainly. Step 1: both mark ready. Step 2: both confirm.
 * The server then runs the trade in one transaction (R-SEC-004), or escrows both stakes and starts
 * the wager battle, which this window hands to the battle screen. Stakes never show whether an item
 * is equipped (only your own loadout warnings are shown, to you). Works at 360x640.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FORMATS, abilityById, itemById } from '@chain-theorem/content';
import { OFFER_MAX_LINES, OFFER_MAX_QTY, type Format, type Offer } from '@chain-theorem/protocol';
import { api, type ServerLoadout } from '../../net/api.ts';
import type { TradeController, TradeDone, TradeState } from '../../trade/controller.ts';
import { closeTrade, startWagerBattle } from '../../trade/session.ts';

type Kind = 'items' | 'cards';
type Inventory = Record<Kind, { id: string; qty: number }[]>;

const KIND_LABEL: Record<Kind, string> = { items: 'item', cards: 'ability card' };
const KIND_ICON: Record<Kind, string> = { items: '◆', cards: '✦' };

export function moduleName(kind: Kind, id: string): string {
  return (kind === 'items' ? itemById.get(id)?.name : abilityById.get(id)?.name) ?? id;
}

function lines(o: Offer): { kind: Kind; id: string; qty: number }[] {
  return [
    ...o.items.map((l) => ({ kind: 'items' as const, ...l })),
    ...o.cards.map((l) => ({ kind: 'cards' as const, ...l })),
  ];
}

/** Your offer with `kind:id` set to `qty` (0 removes the line). */
function withQty(o: Offer, kind: Kind, id: string, qty: number): Offer {
  const rest = o[kind].filter((l) => l.id !== id);
  const next = qty > 0 ? [...rest, { id, qty }] : rest;
  next.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { ...o, [kind]: next };
}

function OfferList({ offer, empty }: { offer: Offer; empty: string }) {
  const all = lines(offer);
  if (all.length === 0) return <p class="muted small-text">{empty}</p>;
  return (
    <ul class="offer-list">
      {all.map((l) => (
        <li key={`${l.kind}:${l.id}`}>
          <span aria-hidden="true">{KIND_ICON[l.kind]}</span>{' '}
          <strong>{moduleName(l.kind, l.id)}</strong>{' '}
          <span class="muted small-text">({KIND_LABEL[l.kind]})</span> × {l.qty}
        </li>
      ))}
    </ul>
  );
}

function Marks({ ready, confirmed }: { ready: boolean; confirmed: boolean }) {
  return (
    <span class="trade-marks small-text">
      <span class={ready ? 'ok' : 'muted'}>
        <span aria-hidden="true">{ready ? '✔' : '○'}</span> {ready ? 'Ready' : 'Not ready'}
      </span>{' '}
      ·{' '}
      <span class={confirmed ? 'ok' : 'muted'}>
        <span aria-hidden="true">{confirmed ? '✔' : '○'}</span>{' '}
        {confirmed ? 'Confirmed' : 'Not confirmed'}
      </span>
    </span>
  );
}

interface MineProps {
  c: TradeController;
  s: TradeState;
  inv: Inventory | null;
  usedIn: ReadonlyMap<string, string[]>;
}

function MyOffer({ c, s, inv, usedIn }: MineProps) {
  const offer = s.me.offer;
  const editable = s.phase === 'invited' || s.phase === 'open';
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState(1);
  const owned = (kind: Kind, id: string) => inv?.[kind].find((x) => x.id === id)?.qty ?? 0;
  const offered = (kind: Kind, id: string) => offer[kind].find((l) => l.id === id)?.qty ?? 0;
  const left = (kind: Kind, id: string) => owned(kind, id) - offered(kind, id);
  const [pk, pid]: [Kind | '', string] = pick ? (pick.split(':') as [Kind, string]) : ['', ''];
  const pickLeft = pk ? left(pk, pid) : 0;
  const wager = s.mode === 'wager';
  const warnings = lines(offer).flatMap((l) => {
    const names = usedIn.get(`${l.kind}:${l.id}`);
    if (!names || owned(l.kind, l.id) > l.qty) return [];
    return [{ key: `${l.kind}:${l.id}`, name: moduleName(l.kind, l.id), loadouts: names }];
  });

  return (
    <section class="trade-side mine" aria-labelledby="trade-mine">
      <h4 id="trade-mine">{wager ? 'Your stake' : 'Your offer'}</h4>
      {lines(offer).length === 0 ? (
        <p class="muted small-text">
          {wager ? 'Stake at least one item or card.' : 'Nothing yet. Add from your collection.'}
        </p>
      ) : (
        <ul class="offer-list">
          {lines(offer).map((l) => {
            const name = moduleName(l.kind, l.id);
            return (
              <li key={`${l.kind}:${l.id}`}>
                <span aria-hidden="true">{KIND_ICON[l.kind]}</span> <strong>{name}</strong>{' '}
                <span class="muted small-text">({KIND_LABEL[l.kind]})</span>
                <span class="qty-edit">
                  <button
                    type="button"
                    class="small"
                    aria-label={`One fewer ${name}`}
                    disabled={!editable}
                    onClick={() => c.offer(withQty(offer, l.kind, l.id, l.qty - 1))}
                  >
                    −
                  </button>
                  <span aria-label={`${name}: ${l.qty}`}>× {l.qty}</span>
                  <button
                    type="button"
                    class="small"
                    aria-label={`One more ${name}`}
                    disabled={!editable || left(l.kind, l.id) <= 0 || l.qty >= OFFER_MAX_QTY}
                    onClick={() => c.offer(withQty(offer, l.kind, l.id, l.qty + 1))}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    class="small ghost"
                    aria-label={`Remove ${name}`}
                    disabled={!editable}
                    onClick={() => c.offer(withQty(offer, l.kind, l.id, 0))}
                  >
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {warnings.map((w) => (
        <p key={w.key} class="note warn small-text">
          <span aria-hidden="true">⚠</span> {w.name} is used in your saved loadout{' '}
          {w.loadouts.map((n) => `“${n}”`).join(', ')}.{' '}
          {wager
            ? 'Your battle still uses it; if you lose it, that loadout is invalid until you fix it.'
            : 'Trading it away makes that loadout invalid until you fix it.'}
        </p>
      ))}
      {editable && (
        <form
          class="trade-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pk || pickLeft <= 0) return;
            const n = Math.max(1, Math.min(pickLeft, Math.floor(qty) || 1));
            c.offer(withQty(offer, pk, pid, offered(pk, pid) + n));
            setPick('');
            setQty(1);
          }}
        >
          <label>
            Add from your collection
            <select
              value={pick}
              onChange={(e) => {
                setPick((e.target as HTMLSelectElement).value);
                setQty(1);
              }}
            >
              <option value="">{inv ? 'Choose…' : 'Loading…'}</option>
              {(['items', 'cards'] as const).map((kind) => (
                <optgroup key={kind} label={kind === 'items' ? 'Items' : 'Ability cards'}>
                  {(inv?.[kind] ?? [])
                    .filter((x) => left(kind, x.id) > 0)
                    .map((x) => (
                      <option key={x.id} value={`${kind}:${x.id}`}>
                        {moduleName(kind, x.id)} (you have {left(kind, x.id)} to spare)
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label class="qty">
            Quantity
            <input
              type="number"
              min={1}
              max={Math.max(1, pickLeft)}
              value={qty}
              disabled={!pick}
              onInput={(e) => setQty(Number((e.target as HTMLInputElement).value))}
            />
          </label>
          <button
            type="submit"
            disabled={
              !pick ||
              pickLeft <= 0 ||
              (pk !== '' && offer[pk].length >= OFFER_MAX_LINES && offered(pk, pid) === 0)
            }
          >
            Add
          </button>
        </form>
      )}
      <Marks ready={s.me.ready} confirmed={s.me.confirmed} />
    </section>
  );
}

function DoneView({
  done,
  s,
}: {
  done: Extract<TradeDone, { mode: 'trade' }>;
  s: TradeState | null;
}) {
  return (
    <div class="trade-result" role="status">
      <p class="note ok">
        <span aria-hidden="true">✔</span> <strong>Trade complete.</strong>
      </p>
      <h4>You received</h4>
      <OfferList offer={done.got} empty="Nothing." />
      <h4>You gave{s ? ` ${s.them.name}` : ''}</h4>
      <OfferList offer={done.gave} empty="Nothing." />
      {done.invalid.length > 0 && (
        <p class="note warn small-text">
          <span aria-hidden="true">⚠</span> Your saved loadout
          {done.invalid.length > 1 ? 's' : ''} {done.invalid.map((n) => `“${n}”`).join(', ')}{' '}
          {done.invalid.length > 1 ? 'are' : 'is'} invalid until you fix{' '}
          {done.invalid.length > 1 ? 'them' : 'it'} (Loadouts screen).
        </p>
      )}
    </div>
  );
}

export function TradeWindow({ c }: { c: TradeController }) {
  const s = c.state.value;
  const done = c.done.value;
  const ended = c.ended.value;
  const error = c.error.value;
  const conn = c.connection.value;
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loadouts, setLoadouts] = useState<ServerLoadout[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const wager = c.mode === 'wager';

  useEffect(() => {
    box.current?.focus();
    api.inventory().then(setInv, () => setInv({ items: [], cards: [] }));
    api.loadouts().then(
      (r) => setLoadouts(r.loadouts),
      () => setLoadouts([]),
    );
  }, [c]);

  // A confirmed wager goes straight to its battle.
  useEffect(() => {
    if (done?.mode === 'wager') startWagerBattle(done);
  }, [done]);

  /** `items:<id>` / `cards:<id>` → names of the player's saved loadouts that use it. */
  const usedIn = useMemo(() => {
    const m = new Map<string, string[]>();
    const add = (k: string, name: string) => m.set(k, [...(m.get(k) ?? []), name]);
    for (const l of loadouts) {
      for (const id of new Set(l.loadout.items)) add(`items:${id}`, l.name);
      for (const id of new Set(l.loadout.sets.flat())) add(`cards:${id}`, l.name);
    }
    return m;
  }, [loadouts]);

  const them = s?.them.name ?? 'the other player';
  const title = wager ? `Wager battle with ${them}` : `Trade with ${them}`;
  const over = done !== null || ended !== null || conn === 'closed';
  const bothReady = s !== null && s.me.ready && s.them.ready;

  return (
    <div class="trade-back">
      <div
        class="trade-window panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-title"
        tabIndex={-1}
        ref={box}
      >
        <h3 id="trade-title">
          <span aria-hidden="true">{wager ? '⚔' : '⇄'}</span> {title}
        </h3>
        {done?.mode === 'trade' && <DoneView done={done} s={s} />}
        {done?.mode === 'wager' && (
          <p class="note ok" role="status">
            Stakes are in escrow. Opening the battle…
          </p>
        )}
        {ended && (
          <p class="note" role="status">
            {ended.reason === 'expired'
              ? 'This trade expired.'
              : ended.reason === 'declined'
                ? `${them} declined.`
                : ended.by === 'you'
                  ? 'You cancelled.'
                  : `${them} cancelled.`}
          </p>
        )}
        {!over && s && (
          <>
            <p class="small-text" role="status" aria-live="polite">
              {s.phase === 'invited'
                ? `Waiting for ${them} to accept…`
                : s.phase === 'executing'
                  ? wager
                    ? 'Both confirmed. Moving the stakes into escrow…'
                    : 'Both confirmed. Trading…'
                  : !s.them.here
                    ? `${them} is not looking at the trade right now.`
                    : bothReady
                      ? 'Step 2: both players confirm.'
                      : 'Step 1: both players mark ready.'}
            </p>
            {s.reset && (
              <p class="note warn trade-reset" role="alert">
                <span aria-hidden="true">↺</span> {s.reset === 'you' ? 'You' : them} changed{' '}
                {wager ? 'the wager' : 'the trade'}, so both players' ready marks and confirmations
                were reset.
              </p>
            )}
            {wager && (
              <div class="trade-wager">
                <label class="inline">
                  Format
                  <select
                    value={s.format ?? 'first_blood'}
                    disabled={s.phase !== 'open' && s.phase !== 'invited'}
                    onChange={(e) => c.setFormat((e.target as HTMLSelectElement).value as Format)}
                  >
                    {Object.values(FORMATS).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p class="muted small-text">
                  The winner takes both stakes. A draw returns them. Leaving the battle counts as a
                  loss. Each of you fights with your newest legal saved loadout, even if it holds
                  your stake.
                </p>
              </div>
            )}
            <div class="trade-sides">
              <MyOffer c={c} s={s} inv={inv} usedIn={usedIn} />
              <section class="trade-side theirs" aria-labelledby="trade-theirs">
                <h4 id="trade-theirs">
                  {them}'s {wager ? 'stake' : 'offer'}{' '}
                  <span class="muted small-text">Lv {s.them.level}</span>
                </h4>
                <OfferList offer={s.them.offer} empty="Nothing yet." />
                <Marks ready={s.them.ready} confirmed={s.them.confirmed} />
              </section>
            </div>
          </>
        )}
        {!over && !s && <p role="status">Connecting…</p>}
        {error && (
          <p class="note warn" role="alert">
            {error}
          </p>
        )}
        {conn === 'reconnecting' && !over && (
          <p class="muted small-text" role="status">
            Reconnecting…
          </p>
        )}
        <div class="row trade-actions">
          {!over && s && (
            <>
              <button
                type="button"
                aria-pressed={s.me.ready}
                disabled={s.phase !== 'open'}
                onClick={() => c.ready(!s.me.ready)}
              >
                {s.me.ready ? 'Not ready' : 'Ready'}
              </button>
              <button
                type="button"
                class="primary"
                disabled={s.phase !== 'open' || !bothReady || s.me.confirmed}
                onClick={() => c.confirm()}
              >
                {wager ? 'Confirm wager' : 'Confirm trade'}
              </button>
              <button
                type="button"
                class="danger"
                disabled={s.phase === 'executing'}
                onClick={() => {
                  c.cancel();
                  closeTrade();
                }}
              >
                {wager ? 'Cancel wager' : 'Cancel trade'}
              </button>
            </>
          )}
          {over && (
            <button type="button" class="primary" onClick={() => closeTrade()}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
