/**
 * The five-phase resolution pipeline (R-ABIL-003, R-ABIL-004, spec 5.3-5.4) and the effect
 * primitives (R-ABIL-002, spec 5.2). One `ActionRun` resolves one committed action on a private draft
 * of the state. Choices suspend the run (DD-11): the caller stores the pre-action snapshot and the
 * answers so far, and resumes by re-running deterministically with one more answer.
 */
import {
  BLACK,
  WHITE,
  backRank,
  castlingMaskFor,
  elementFor,
  fileOf,
  opposite,
  rankOf,
  relOrder,
  sideCode,
  typeOf,
} from '../board.ts';
import {
  F_CAPTURE,
  F_CASTLE,
  F_DOUBLE,
  F_EP,
  Pos,
  decodeMove,
  encodeMove,
  mFrom,
  mPromo,
  mTo,
} from '../movegen.ts';
import type {
  AbilityDef,
  Anchor,
  BonusSpec,
  CaptureInfo,
  Condition,
  EffectCondition,
  EffectInfo,
  EffectSpec,
  Pattern,
  PieceFilter,
  PieceView,
  QueuedTrigger,
  RevealSpec,
  SquareFilter,
  SquareSpec,
  TargetSpec,
  TriggerInfo,
} from '../sdk/types.ts';
import {
  type BattleResult,
  type Category,
  type ChoiceOption,
  type ChoiceRequest,
  type ElementId,
  type FizzleReason,
  type GameState,
  type MoveInput,
  type PieceId,
  type PieceType,
  type RevealCause,
  type Side,
  type SourceRef,
  type Square,
  RulesError,
} from '../types.ts';
import { beats } from './elements.ts';
import { EventHost } from './host.ts';
import { type Change, rulesAfterTurnEnd, simulate } from './simulate.ts';
import { type HookEntry, type Runtime, sourceOf } from './runtime.ts';

export class NeedChoice {
  readonly request: ChoiceRequest;
  constructor(request: ChoiceRequest) {
    this.request = request;
  }
}

interface Cap {
  id: number;
  captor: PieceId;
  victim: PieceId;
  from: Square;
  to: Square;
  depth: number;
  /** Elements fixed when the move is committed (captor before promotion), used for silence. */
  captorElement: ElementId;
  victimElement: ElementId;
}

interface Trig {
  piece: PieceId;
  side: Side;
  /** Piece type whose set produced this trigger; a later promotion does not change it (8.2). */
  setType: PieceType;
  def: AbilityDef;
  category: Category;
  cap: Cap;
  seq: number;
}

interface TCtx {
  trig: Trig;
  owner: Side;
  bearer: PieceId;
  cap: Cap;
  source: SourceRef;
}

interface Negation {
  piece: PieceId;
  categories: Category[];
  capture: number;
  source: SourceRef;
}

interface Protection {
  piece: PieceId;
  remaining: number;
  source: SourceRef;
}

function near(pattern: Pattern, a: Square, b: Square): boolean {
  const df = Math.abs(fileOf(a) - fileOf(b));
  const dr = Math.abs(rankOf(a) - rankOf(b));
  if (pattern === 'adjacent') return Math.max(df, dr) === 1;
  if (pattern === 'diagonal') return df === 1 && dr === 1;
  return df + dr === 1;
}

function sameOption(a: ChoiceOption, b: ChoiceOption): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'decline':
      return true;
    case 'piece':
      return b.kind === 'piece' && a.piece === b.piece && a.square === b.square;
    case 'square':
      return b.kind === 'square' && a.square === b.square;
    case 'move':
      return b.kind === 'move' && a.from === b.from && a.to === b.to && a.promotion === b.promotion;
  }
}

export function eligibleFor(def: AbilityDef, type: PieceType): boolean {
  return def.eligible === 'all' || def.eligible.includes(type);
}

export class ActionRun extends EventHost {
  readonly made: ChoiceOption[] = [];
  readonly actor: Side;
  private answerIdx = 0;
  private preIdx: number;
  private promptN = 0;
  private seq = 0;
  private captureN = 0;
  private readonly fired = new Set<string>();
  private readonly negations: Negation[] = [];
  private readonly protections: Protection[] = [];
  private readonly chainEnd: { effects: EffectSpec[]; tc: TCtx }[] = [];
  /** Activations that already spent their charge (DD-48). */
  private readonly spent = new Set<Trig>();
  private readonly stalwartCaptured = new Set<Side>();
  private objectiveWinner: Side | null = null;
  private irreversible = false;
  private currentQueue: Trig[] = [];
  private readonly input: MoveInput;
  private readonly answers: readonly ChoiceOption[];

  constructor(
    rt: Runtime,
    s: GameState,
    input: MoveInput,
    answers: readonly ChoiceOption[],
    preUsed: number,
  ) {
    super(rt, s);
    this.input = input;
    this.answers = answers;
    this.actor = input.side;
    this.preIdx = preUsed;
  }

  get preUsed(): number {
    return this.preIdx;
  }

  queueSnapshot(): { piece: PieceId; ability: string }[] {
    return this.currentQueue.map((t) => ({ piece: t.piece, ability: t.def.id }));
  }

  // ---- entry point --------------------------------------------------------------------------------

  execute(encoded: number): void {
    const s = this.s;
    this.emit({ k: 'ActionStarted', side: this.actor, ply: s.ply, move: decodeMove(encoded) });
    this.revealStalwartIfRelaxed(encoded, this.actor);
    this.runMove(encoded, 0, this.actor, false);
    // Chain end (Rebirth and other deferred effects), in the order their triggers resolved.
    while (this.chainEnd.length > 0) {
      const d = this.chainEnd.shift() as { effects: EffectSpec[]; tc: TCtx };
      this.depth = 0;
      if (this.resolveEffects(d.effects, d.tc)) this.spendCharge(d.tc.trig);
    }
    this.depth = 0;
    this.settle();
  }

  // ---- phases ------------------------------------------------------------------------------------

  private runMove(m: number, depth: number, mover: Side, bonus: boolean): void {
    const s = this.s;
    const from = mFrom(m);
    const to = mTo(m);
    const pid = s.board[from] as number;
    const piece = s.pieces[pid];
    if (!piece) throw new RulesError('internal', `no piece on ${from}`);
    const prevDepth = this.depth;
    this.depth = depth;
    const victimSq = m & F_EP ? to + (piece.side === 'white' ? -8 : 8) : m & F_CAPTURE ? to : -1;
    const vid = victimSq >= 0 ? (s.board[victimSq] as number) : -1;
    let cap: Cap | null = null;
    if (vid >= 0) {
      const victim = s.pieces[vid];
      if (!victim) throw new RulesError('internal', 'victim missing');
      cap = {
        // Unique within the battle and identical on replay (DD-11).
        id: s.ply * 1000 + this.captureN++,
        captor: pid,
        victim: vid,
        from,
        to,
        depth,
        captorElement: piece.element,
        victimElement: victim.element,
      };
      // Phase 2: Before capture. The captor's CAPTURING abilities, in loadout order.
      for (const t of this.collect(pid, 'CAPTURING', cap)) {
        if (this.filterTrigger(t) === 'allow') this.resolveTrigger(t);
      }
    }
    // Phase 3: Capture. Atomically remove the victim and move the captor (INV-05).
    if (piece.square !== from) {
      // A committed action is spent even if its piece was displaced (INV-06); nothing moves.
      this.depth = prevDepth;
      return;
    }
    let captured = false;
    if (cap && (s.pieces[vid] as { square: number }).square === victimSq) {
      this.capturePiece(vid, 'move', pid, undefined);
      captured = true;
    }
    this.movePiece(m, bonus, captured);
    // Phase 4: Reactions. Victim's CAPTURED first, then captor's CAPTURES; Always First reorders.
    if (cap && captured) {
      let queue: Trig[] = [];
      for (const t of this.collect(vid, 'CAPTURED', cap))
        if (this.filterTrigger(t) === 'allow') queue.push(t);
      for (const t of this.collect(pid, 'CAPTURES', cap))
        if (this.filterTrigger(t) === 'allow') queue.push(t);
      queue = this.orderQueue(queue);
      const saved = this.currentQueue;
      this.currentQueue = queue;
      for (let i = 0; i < queue.length; i++) {
        this.currentQueue = queue.slice(i);
        this.resolveTrigger(queue[i] as Trig);
      }
      this.currentQueue = saved;
    }
    this.depth = prevDepth;
  }

  private capturePiece(
    vid: PieceId,
    by: 'move' | 'effect',
    captor: PieceId | null,
    source: SourceRef | undefined,
  ): number {
    const s = this.s;
    const v = s.pieces[vid];
    if (!v) throw new RulesError('internal', 'capture of missing piece');
    const square = v.square;
    this.lastSq.set(vid, square);
    s.board[square] = -1;
    v.square = -1;
    v.capturedSeq = ++s.captureSeq;
    s.castling &= ~castlingMaskFor(square);
    this.irreversible = true;
    this.emit({
      k: 'Captured',
      victim: vid,
      victimSide: v.side,
      victimType: v.type,
      square,
      by,
      captor,
      ...(source ? { source } : {}),
    });
    if (v.type !== 'pawn') {
      const credit =
        by === 'move'
          ? (s.pieces[captor ?? -1]?.side ?? opposite(v.side))
          : source && 'side' in source
            ? source.side
            : opposite(v.side);
      s.objective = { ...s.objective, [credit]: s.objective[credit] + 1 };
      const need = this.rt.caps.FORMATS[s.format]?.objective?.nonPawnCaptures;
      if (need !== undefined && this.objectiveWinner === null && s.objective[credit] >= need)
        this.objectiveWinner = credit;
    }
    if (v.type === 'king') {
      // Only a Stalwart king can be captured, and only by a move (R-RULES-003, R-RULES-004).
      this.stalwartCaptured.add(v.side);
      const src = this.stalwartSource(v.side);
      if (src)
        this.reveal(
          v.side,
          { kind: 'ability', pieceType: 'king', ability: src.id },
          'observed',
          sourceOf(src),
        );
    }
    return v.capturedSeq;
  }

  private movePiece(m: number, bonus: boolean, capture: boolean): void {
    const s = this.s;
    const from = mFrom(m);
    const to = mTo(m);
    const promo = mPromo(m);
    const pid = s.board[from] as number;
    const p = s.pieces[pid];
    if (!p) throw new RulesError('internal', 'move of missing piece');
    const typeBefore = p.type;
    s.board[from] = -1;
    s.board[to] = pid;
    p.square = to;
    s.castling &= ~(castlingMaskFor(from) | castlingMaskFor(to));
    if (p.type === 'pawn') this.irreversible = true;
    s.ep = m & F_DOUBLE && (s.board[(from + to) >> 1] as number) < 0 ? (from + to) >> 1 : -1;
    let rook: { id: PieceId; from: Square; to: Square } | null = null;
    if (m & F_CASTLE) {
      const kingSide = to > from;
      const rf = kingSide ? from + 3 : from - 4;
      const rt = kingSide ? from + 1 : from - 1;
      const rid = s.board[rf] as number;
      const r = s.pieces[rid];
      if (r) {
        s.board[rf] = -1;
        s.board[rt] = rid;
        r.square = rt;
        rook = { id: rid, from: rf, to: rt };
      }
    }
    if (promo) {
      // R-RULES-002: a promoted piece adopts its new type's ability set and group element.
      p.type = typeOf(promo);
      p.element = elementFor(s.armies[p.side].loadout.elements, p.type);
    }
    this.emit({
      k: 'MoveMade',
      side: p.side,
      piece: pid,
      pieceType: typeBefore,
      from,
      to,
      capture,
      bonus,
      ...(m & F_EP ? { enPassant: true } : {}),
      ...(m & F_CASTLE ? { castle: to > from ? ('K' as const) : ('Q' as const) } : {}),
      ...(promo ? { promotion: p.type as 'queen' } : {}),
    });
    if (promo)
      this.emit({
        k: 'Promoted',
        piece: pid,
        side: p.side,
        to: p.type as 'queen',
        element: p.element,
      });
    this.pieceMoved(pid, from, to, m & F_CASTLE ? 'castle' : bonus ? 'bonus' : 'move', capture);
    if (rook) this.pieceMoved(rook.id, rook.from, rook.to, 'castle', false);
  }

  private pieceMoved(
    id: PieceId,
    from: Square,
    to: Square,
    cause: 'move' | 'castle' | 'bonus' | 'effect' | 'revive',
    capture: boolean,
  ): void {
    const hooks = this.rt.hook(this.s, 'onPieceMoved');
    if (hooks.length === 0) return;
    const piece = this.rt.view(this, id);
    for (const e of hooks)
      e.hooks.onPieceMoved?.(this.rt.ctx(this, e), {
        piece,
        from,
        to,
        cause,
        capture,
        depth: this.depth,
      });
  }

  // ---- triggers ----------------------------------------------------------------------------------

  private collect(pid: PieceId, category: Category, cap: Cap): Trig[] {
    const s = this.s;
    const p = s.pieces[pid];
    if (!p) return [];
    const out: Trig[] = [];
    const view = this.rt.view(this, pid);
    for (const id of s.armies[p.side].sets[p.type]) {
      const def = this.rt.ability(id);
      // Retirement is a loadout rule (R-LOAD-004 rule 7): a battle keeps every module it started
      // with, so it plays and replays the same way (13.5, DD-49).
      if (!def || def.category !== category) continue;
      // An ability ineligible for this type does nothing here (7.3).
      if (!eligibleFor(def, p.type)) continue;
      if (this.fired.has(`${pid}:${id}`)) continue;
      const { attuned, via } = this.attunement(view, def);
      const baseOk = (def.conditions ?? []).every((c) => this.condHolds(c, cap));
      const conds: Condition[] =
        attuned && def.attuned?.conditions !== undefined
          ? def.attuned.conditions
          : (def.conditions ?? []);
      if (!conds.every((c) => this.condHolds(c, cap))) continue;
      if (def.limits.charges !== undefined && this.remainingCharges(view, def) <= 0) continue;
      // An item's attunement that alone lets this trigger happen is observable (8.2).
      if (via && !baseOk) this.revealEntry(via, 'observed');
      out.push({ piece: pid, side: p.side, setType: p.type, def, category, cap, seq: this.seq++ });
    }
    return out;
  }

  private condHolds(c: Condition, cap: Cap): boolean {
    const victim = this.s.pieces[cap.victim] as { type: PieceType };
    const captor = this.s.pieces[cap.captor] as { type: PieceType };
    if ('victimTypeNot' in c) return victim.type !== c.victimTypeNot;
    if ('victimTypeIs' in c) return c.victimTypeIs.includes(victim.type);
    if ('captorTypeIs' in c) return c.captorTypeIs.includes(captor.type);
    return captor.type !== c.captorTypeNot;
  }

  remainingCharges(view: PieceView, def: AbilityDef): number {
    let max = def.limits.charges ?? Infinity;
    for (const e of this.rt.hook(this.s, 'modifyCharges')) {
      max = e.hooks.modifyCharges?.(this.rt.ctx(this, e), view, def, max) ?? max;
    }
    return max - (this.s.usage[`${view.id}:${def.id}`] ?? 0);
  }

  private attunement(view: PieceView, def: AbilityDef): { attuned: boolean; via?: HookEntry } {
    if (!def.attuned || def.affinity === 'neutral') return { attuned: false };
    if (view.element === def.affinity) return { attuned: true };
    for (const e of this.rt.hook(this.s, 'attunement')) {
      if (e.hooks.attunement?.(this.rt.ctx(this, e), view, def)) return { attuned: true, via: e };
    }
    return { attuned: false };
  }

  /** The bearer as the trigger's own piece type sees it (reveals, Veil). */
  private trigView(t: Trig): PieceView {
    return { ...this.rt.view(this, t.piece), type: t.setType };
  }

  private triggerInfo(t: Trig): TriggerInfo {
    const bearerIsCaptor = t.piece === t.cap.captor;
    return {
      piece: this.rt.view(this, t.piece),
      side: t.side,
      ability: t.def,
      category: t.category,
      capture: this.captureInfo(t.cap),
      element: bearerIsCaptor ? t.cap.captorElement : t.cap.victimElement,
      otherElement: bearerIsCaptor ? t.cap.victimElement : t.cap.captorElement,
    };
  }

  private captureInfo(cap: Cap): CaptureInfo {
    return {
      id: cap.id,
      captor: this.rt.view(this, cap.captor),
      victim: this.rt.view(this, cap.victim),
      from: cap.from,
      to: cap.to,
      depth: cap.depth,
    };
  }

  private actionNegation(t: Trig): Negation | undefined {
    return this.negations.find(
      (n) => n.piece === t.piece && n.categories.includes(t.category) && n.capture === t.cap.id,
    );
  }

  /** triggerFilter (13.5): negation first (action NEGATEs, then hooks), then the silence rule (6.2). */
  private filterTrigger(t: Trig): 'allow' | 'silence' | 'negate' {
    const neg = this.actionNegation(t);
    if (neg) {
      this.emitNegated(t, neg.source);
      return 'negate';
    }
    const info = this.triggerInfo(t);
    let hookSilence: HookEntry | null = null;
    for (const e of this.rt.hook(this.s, 'triggerFilter')) {
      const v = e.hooks.triggerFilter?.(this.rt.ctx(this, e), info);
      if (v === 'negate') {
        this.revealEntry(e, 'observed');
        this.emitNegated(t, sourceOf(e));
        return 'negate';
      }
      if (v === 'silence' && !hookSilence) hookSilence = e;
    }
    if (this.silencedByElement(t) || hookSilence) {
      for (const e of this.rt.hook(this.s, 'silenceOverride')) {
        if (e.hooks.silenceOverride?.(this.rt.ctx(this, e), info)) return 'allow';
      }
      const other = t.piece === t.cap.captor ? t.cap.victim : t.cap.captor;
      const view = this.trigView(t);
      this.emit({
        k: 'AbilitySilenced',
        side: t.side,
        piece: t.piece,
        pieceType: view.type,
        ability: t.def.id,
        category: t.category,
        by: other,
      });
      this.reveal(
        t.side,
        { kind: 'ability', pieceType: view.type, ability: t.def.id },
        'silenced',
        undefined,
        view,
      );
      return 'silence';
    }
    return 'allow';
  }

  /** R-ELEM-002 silence rule with the silenceScope knob. */
  private silencedByElement(t: Trig): boolean {
    const scope = this.rt.caps.SILENCE_SCOPE;
    if (scope === 'OFF') return false;
    if (t.category === 'CAPTURED') return beats(t.cap.captorElement, t.cap.victimElement);
    if (t.category === 'CAPTURING' && scope === 'REACTIONS_ONLY') return false;
    return beats(t.cap.victimElement, t.cap.captorElement);
  }

  private emitNegated(t: Trig, source: SourceRef): void {
    const view = this.trigView(t);
    this.emit({
      k: 'AbilityNegated',
      side: t.side,
      piece: t.piece,
      pieceType: view.type,
      ability: t.def.id,
      category: t.category,
      source,
    });
    this.reveal(
      t.side,
      { kind: 'ability', pieceType: view.type, ability: t.def.id },
      'negated',
      undefined,
      view,
    );
  }

  private orderQueue(queue: Trig[]): Trig[] {
    const hooks = this.rt.hook(this.s, 'queueOrder');
    if (hooks.length === 0 || queue.length < 2) return queue;
    const bySeq = new Map(queue.map((t) => [t.seq, t]));
    let q: QueuedTrigger[] = queue.map((t) => ({
      piece: t.piece,
      side: t.side,
      ability: t.def.id,
      category: t.category,
      element: this.s.pieces[t.piece]?.element ?? 'neutral',
      seq: t.seq,
    }));
    for (const e of hooks) {
      const next = e.hooks.queueOrder?.(this.rt.ctx(this, e), q);
      if (next && next.length === q.length && next.every((x) => bySeq.has(x.seq))) q = next;
    }
    return q.map((x) => bySeq.get(x.seq) as Trig);
  }

  private resolveTrigger(t: Trig): void {
    const neg = this.actionNegation(t);
    if (neg) {
      // A NEGATE registered by an earlier activation cancels queued triggers (5.2).
      this.emitNegated(t, neg.source);
      return;
    }
    const key = `${t.piece}:${t.def.id}`;
    if (this.fired.has(key)) return;
    this.fired.add(key);
    const view = this.trigView(t);
    // DD-36: attunement follows the bearer's element when the ability resolves.
    const { attuned, via } = this.attunement(this.rt.view(this, t.piece), t.def);
    this.emit({
      k: 'AbilityTriggered',
      side: t.side,
      piece: t.piece,
      pieceType: view.type,
      ability: t.def.id,
      category: t.category,
      attuned,
    });
    this.reveal(
      t.side,
      { kind: 'ability', pieceType: view.type, ability: t.def.id },
      'activated',
      undefined,
      view,
    );
    if (via) this.revealEntry(via, 'observed');
    const effects =
      attuned && t.def.attuned
        ? t.def.attuned.mode === 'replace'
          ? t.def.attuned.effects
          : [...t.def.effects, ...t.def.attuned.effects]
        : t.def.effects;
    const tc: TCtx = {
      trig: t,
      owner: t.side,
      bearer: t.piece,
      cap: t.cap,
      source: { kind: 'ability', id: t.def.id, piece: t.piece, side: t.side },
    };
    if (this.resolveEffects(effects, tc)) this.spendCharge(t);
  }

  /**
   * Charges are spent only when at least one effect of the activation resolves (DD-17), and at most
   * once per activation even when both an immediate and a chain-end effect resolve (DD-48).
   */
  private spendCharge(t: Trig): void {
    if (t.def.limits.charges === undefined || this.spent.has(t)) return;
    this.spent.add(t);
    const key = `${t.piece}:${t.def.id}`;
    this.s.usage = { ...this.s.usage, [key]: (this.s.usage[key] ?? 0) + 1 };
    const view = this.rt.view(this, t.piece);
    this.emit({
      k: 'ChargeSpent',
      side: t.side,
      piece: t.piece,
      pieceType: t.setType,
      ability: t.def.id,
      remaining: Math.max(0, this.remainingCharges(view, t.def)),
    });
  }

  private revealEntry(e: HookEntry, cause: RevealCause): void {
    if (e.owner === null) return;
    if (e.kind === 'item') this.reveal(e.owner, { kind: 'item', item: e.id }, cause, sourceOf(e));
  }

  // ---- effects -----------------------------------------------------------------------------------

  private resolveEffects(list: readonly EffectSpec[], tc: TCtx): boolean {
    let any = false;
    for (const eff of list) if (this.resolveEffect(eff, tc)) any = true;
    return any;
  }

  private resolveEffect(eff: EffectSpec, tc: TCtx): boolean {
    switch (eff.op) {
      case 'effectCapture':
        return this.fxEffectCapture(eff.target, tc);
      case 'negate': {
        const piece = eff.of === 'victim' ? tc.cap.victim : tc.cap.captor;
        this.negations.push({
          piece,
          categories: eff.categories,
          capture: tc.cap.id,
          source: tc.source,
        });
        return true;
      }
      case 'protect': {
        const target = this.resolveTarget(eff.target, tc, 'protect');
        if (!target || target.square < 0) {
          this.fizzle(tc, 'protect', eff.target.t === 'self' ? 'no_body' : 'no_target');
          return false;
        }
        this.protections.push({
          piece: target.id,
          remaining: eff.count === 'all' ? Infinity : eff.count,
          source: tc.source,
        });
        return true;
      }
      case 'move':
        return this.fxMove(eff.piece, eff.to, tc);
      case 'revive':
        return this.fxRevive(eff.piece, eff.to, tc);
      case 'bonusAction':
        return this.fxBonus(eff.bonus, tc);
      case 'reveal':
        return this.fxReveal(eff.reveal, tc);
      case 'modifyRule':
        return false;
      case 'when':
        return this.evalCond(eff.cond, tc) ? this.resolveEffects(eff.then, tc) : false;
      case 'atChainEnd':
        this.chainEnd.push({ effects: eff.effects, tc });
        return false;
    }
  }

  private fizzle(
    tc: TCtx,
    effect: string,
    reason: FizzleReason,
    target?: PieceId,
    source?: SourceRef,
  ): void {
    this.emit({
      k: 'EffectFizzled',
      side: tc.owner,
      piece: tc.bearer,
      pieceType: tc.trig.setType,
      ability: tc.trig.def.id,
      effect,
      reason,
      ...(target !== undefined ? { target } : {}),
      ...(source ? { source } : {}),
    });
  }

  private pieceSquare(id: PieceId): Square {
    return this.lastSquare(id);
  }

  private anchorSquare(a: Anchor, tc: TCtx): Square {
    switch (a) {
      case 'self':
        return this.pieceSquare(tc.bearer);
      case 'captor':
        return this.pieceSquare(tc.cap.captor);
      case 'victim':
        return this.pieceSquare(tc.cap.victim);
      case 'origin':
        return tc.cap.from;
      case 'landing':
        return tc.cap.to;
    }
  }

  private resolveTarget(
    spec: TargetSpec,
    tc: TCtx,
    purpose: 'capture' | 'move' | 'revive' | 'protect',
  ): PieceView | null {
    const s = this.s;
    switch (spec.t) {
      case 'self':
        return this.rt.view(this, tc.bearer);
      case 'captor':
        return this.rt.view(this, tc.cap.captor);
      case 'victim':
        return this.rt.view(this, tc.cap.victim);
      case 'mostRecentCaptured': {
        const side = spec.side === 'friendly' ? tc.owner : opposite(tc.owner);
        let best: PieceView | null = null;
        let bestSeq = -1;
        for (const p of s.pieces) {
          if (p.side === side && p.square < 0 && p.type === spec.type && p.capturedSeq > bestSeq) {
            best = this.rt.view(this, p.id);
            bestSeq = p.capturedSeq;
          }
        }
        return best;
      }
      case 'chosen': {
        const options = this.pieceOptions(spec.filter, tc, purpose);
        const choice = this.choose(tc.owner, 'target', options, tc, false, { purpose });
        if (!choice || choice.kind !== 'piece') return null;
        return this.rt.view(this, choice.piece);
      }
    }
  }

  /** Candidate pieces for a chosen target, filtered by public rules only (DD-19). */
  private pieceOptions(
    f: PieceFilter,
    tc: TCtx,
    purpose: 'capture' | 'move' | 'revive' | 'protect',
  ): ChoiceOption[] {
    const s = this.s;
    const anchor = f.near ? this.anchorSquare(f.near.of, tc) : -1;
    if (f.near && anchor < 0) return [];
    const excluded = new Set<PieceId>();
    for (const x of f.exclude ?? [])
      excluded.add(x === 'captor' ? tc.cap.captor : x === 'victim' ? tc.cap.victim : tc.bearer);
    const out: { o: ChoiceOption; key: number }[] = [];
    for (const p of s.pieces) {
      if (p.square < 0 || excluded.has(p.id)) continue;
      if (f.side === 'enemy' && p.side === tc.owner) continue;
      if (f.side === 'friendly' && p.side !== tc.owner) continue;
      if (f.types && !f.types.includes(p.type)) continue;
      if (f.near && !near(f.near.pattern, anchor, p.square)) continue;
      if (purpose === 'capture') {
        if (p.type === 'king') continue; // Royal Immunity: kings cannot be targeted (R-RULES-004).
        if (this.inv03Verdict({ remove: p.id }, tc.owner) === 'fails') continue;
      }
      out.push({
        o: { kind: 'piece', piece: p.id, square: p.square },
        key: relOrder(tc.owner, p.square),
      });
    }
    return out.sort((a, b) => a.key - b.key).map((x) => x.o);
  }

  private resolveSquare(
    spec: SquareSpec,
    piece: PieceView,
    tc: TCtx,
    kind: 'move' | 'revive',
  ): Square | null {
    if (spec.s === 'origin') return tc.cap.from;
    if (spec.s === 'start') return piece.start;
    const options = this.squareOptions(spec.filter, piece, tc, kind);
    const choice = this.choose(tc.owner, 'square', options, tc, false, { subject: piece.id });
    if (!choice || choice.kind !== 'square') return null;
    return choice.square;
  }

  private squareOptions(
    f: SquareFilter,
    piece: PieceView,
    tc: TCtx,
    kind: 'move' | 'revive',
  ): ChoiceOption[] {
    const s = this.s;
    const candidates = new Set<Square>();
    const anchor = f.near ? this.anchorSquare(f.near.of, tc) : -1;
    for (let sq = 0; sq < 64; sq++) {
      if ((s.board[sq] as number) >= 0) continue;
      if (f.near && (anchor < 0 || !near(f.near.pattern, anchor, sq))) continue;
      if (f.backRank && rankOf(sq) !== backRank(tc.owner)) continue;
      if (!f.near && !f.backRank) continue;
      candidates.add(sq);
    }
    for (const inc of f.include ?? []) {
      const sq = inc === 'origin' ? tc.cap.from : piece.start;
      if (sq >= 0 && (s.board[sq] as number) < 0) candidates.add(sq);
    }
    const blocked = this.blockedFor(piece);
    const out: { o: ChoiceOption; key: number }[] = [];
    for (const sq of candidates) {
      if (blocked.has(sq)) continue;
      const change =
        kind === 'move' ? { move: { id: piece.id, to: sq } } : { place: { id: piece.id, to: sq } };
      if (this.inv03Verdict(change, tc.owner) === 'fails') continue;
      out.push({ o: { kind: 'square', square: sq }, key: relOrder(tc.owner, sq) });
    }
    return out.sort((a, b) => a.key - b.key).map((x) => x.o);
  }

  private blockedFor(piece: PieceView): Set<Square> {
    const out = new Set<Square>();
    for (const e of this.rt.hook(this.s, 'moveFilter')) {
      const sq = e.hooks.moveFilter?.blockedSquares?.(this.rt.ctx(this, e), piece);
      if (sq) for (const x of sq) out.add(x);
    }
    return out;
  }

  /**
   * Choice point (5.4 mid-action choices). Uses recorded answers first (replay), then pre-supplied
   * commit choices of the mover, else suspends with NeedChoice.
   */
  private choose(
    chooser: Side,
    kind: ChoiceRequest['kind'],
    options: ChoiceOption[],
    tc: TCtx,
    optional: boolean,
    about: Pick<ChoiceRequest, 'purpose' | 'subject'> = {},
  ): ChoiceOption | null {
    if (options.length === 0) return null;
    if (!optional && options.length === 1) return options[0] as ChoiceOption;
    const all: ChoiceOption[] = optional ? [{ kind: 'decline' }, ...options] : options;
    const promptId = `${this.s.ply}.${this.promptN++}`;
    let answer: ChoiceOption | undefined;
    if (this.answerIdx < this.answers.length) {
      answer = this.answers[this.answerIdx++];
      if (!answer || !all.some((o) => sameOption(o, answer as ChoiceOption))) {
        throw new RulesError('bad_choice', 'recorded answer does not match the replayed prompt');
      }
    } else {
      const pre = this.input.choices;
      if (
        pre &&
        chooser === this.actor &&
        this.depth === 0 &&
        tc.trig.category === 'CAPTURING' &&
        this.preIdx < pre.length
      ) {
        const candidate = pre[this.preIdx] as ChoiceOption;
        if (all.some((o) => sameOption(o, candidate))) {
          answer = candidate;
          this.preIdx++;
        }
      }
    }
    if (!answer) {
      throw new NeedChoice({
        promptId,
        chooser,
        source: { ability: tc.trig.def.id, piece: tc.bearer, side: tc.owner },
        kind,
        ...about,
        options: all,
        defaultOption: 0,
      });
    }
    this.made.push(answer);
    this.emit({ k: 'ChoiceMade', side: chooser, promptId, option: answer });
    return answer;
  }

  private fxEffectCapture(spec: TargetSpec, tc: TCtx): boolean {
    const target = this.resolveTarget(spec, tc, 'capture');
    if (!target || target.square < 0) {
      this.fizzle(tc, 'effectCapture', 'no_target', target?.id);
      return false;
    }
    const verdict = this.intercept({
      kind: 'effectCapture',
      target,
      source: tc.source,
      sourceSide: tc.owner,
      actor: this.actor,
    });
    if (verdict) {
      this.fizzle(tc, 'effectCapture', verdict.reason, target.id, verdict.source);
      return false;
    }
    this.capturePiece(target.id, 'effect', tc.bearer, tc.source);
    return true;
  }

  private fxMove(pieceSpec: TargetSpec, to: SquareSpec, tc: TCtx): boolean {
    const piece = this.resolveTarget(pieceSpec, tc, 'move');
    if (!piece || piece.square < 0) {
      // Self-acting effects fizzle without a body (5.4).
      this.fizzle(tc, 'move', pieceSpec.t === 'self' ? 'no_body' : 'no_target', piece?.id);
      return false;
    }
    const dest = this.resolveSquare(to, piece, tc, 'move');
    if (dest === null || dest < 0) {
      this.fizzle(tc, 'move', 'no_target', piece.id);
      return false;
    }
    if ((this.s.board[dest] as number) >= 0) {
      this.fizzle(tc, 'move', 'occupied', piece.id);
      return false;
    }
    const verdict = this.intercept({
      kind: 'move',
      target: piece,
      to: dest,
      source: tc.source,
      sourceSide: tc.owner,
      actor: this.actor,
    });
    if (verdict) {
      this.fizzle(tc, 'move', verdict.reason, piece.id, verdict.source);
      return false;
    }
    const s = this.s;
    const p = s.pieces[piece.id] as { square: number; side: Side };
    const from = p.square;
    s.board[from] = -1;
    s.board[dest] = piece.id;
    p.square = dest;
    s.castling &= ~castlingMaskFor(from);
    this.emit({
      k: 'PieceMoved',
      piece: piece.id,
      side: p.side,
      from,
      to: dest,
      source: tc.source,
    });
    this.pieceMoved(piece.id, from, dest, 'effect', false);
    return true;
  }

  private fxRevive(pieceSpec: TargetSpec, to: SquareSpec, tc: TCtx): boolean {
    const piece = this.resolveTarget(pieceSpec, tc, 'revive');
    if (!piece) {
      this.fizzle(tc, 'revive', 'no_target');
      return false;
    }
    if (piece.square >= 0) {
      this.fizzle(tc, 'revive', 'already_on_board', piece.id);
      return false;
    }
    const dest = this.resolveSquare(to, piece, tc, 'revive');
    if (dest === null || dest < 0) {
      this.fizzle(tc, 'revive', 'no_target', piece.id);
      return false;
    }
    if ((this.s.board[dest] as number) >= 0) {
      this.fizzle(tc, 'revive', 'occupied', piece.id);
      return false;
    }
    const verdict = this.intercept({
      kind: 'revive',
      target: piece,
      to: dest,
      source: tc.source,
      sourceSide: tc.owner,
      actor: this.actor,
    });
    if (verdict) {
      this.fizzle(tc, 'revive', verdict.reason, piece.id, verdict.source);
      return false;
    }
    const p = this.s.pieces[piece.id] as { square: number; side: Side };
    p.square = dest;
    this.s.board[dest] = piece.id;
    this.emit({
      k: 'PieceRevived',
      piece: piece.id,
      side: p.side,
      square: dest,
      source: tc.source,
    });
    this.pieceMoved(piece.id, -1, dest, 'revive', false);
    return true;
  }

  private fxReveal(spec: RevealSpec, tc: TCtx): boolean {
    const s = this.s;
    if (spec.what === 'typeSet') {
      const id =
        spec.of === 'victim' ? tc.cap.victim : spec.of === 'captor' ? tc.cap.captor : tc.bearer;
      const p = s.pieces[id];
      if (!p) return false;
      this.reveal(
        p.side,
        { kind: 'set', pieceType: p.type, abilities: [...s.armies[p.side].sets[p.type]] },
        'effect',
        tc.source,
      );
      return true;
    }
    const opp = opposite(tc.owner);
    const items = s.armies[opp].loadout.items;
    if (spec.what === 'items') {
      this.reveal(opp, { kind: 'items', items: [...items] }, 'effect', tc.source);
      return true;
    }
    let best: string | null = null;
    let bestCost = -1;
    for (const id of [...items].sort()) {
      const cost = this.rt.items.get(id)?.slotCost ?? 0;
      if (cost > bestCost) {
        best = id;
        bestCost = cost;
      }
    }
    if (!best) {
      this.fizzle(tc, 'reveal', 'no_target');
      return false;
    }
    this.reveal(opp, { kind: 'item', item: best }, 'effect', tc.source);
    return true;
  }

  // ---- bonus actions (INV-01) --------------------------------------------------------------------

  /** A position for move generation mid-action; own-king safety uses the rules after the turn ends. */
  private positionFor(side: Side, strictSide: Side | null = null): Pos {
    const kingSources = new Map<Side, HookEntry>();
    const rules = this.rt.moveRules(this, kingSources);
    const pos = Pos.fromState(this.s, rules);
    pos.safety = rulesAfterTurnEnd(this.rt, this.s, this.actor);
    if (strictSide) {
      // Judge `strictSide`'s king as ordinary, keeping the other side's rules (DD-32 comparisons).
      const code = sideCode(strictSide);
      const flip = (r: typeof rules) => {
        const stalwart: [boolean, boolean] = [r.stalwart[0], r.stalwart[1]];
        stalwart[code] = false;
        return { ...r, stalwart };
      };
      pos.rules = flip(rules);
      if (pos.safety) pos.safety = flip(pos.safety);
    }
    if (side !== this.s.turn) pos.ep = -1;
    return pos;
  }

  private legalFor(side: Side): number[] {
    return this.positionFor(side).legal(sideCode(side));
  }

  /**
   * Would this bonus move leave the acting player's ordinary king in check (INV-03)? Simulated on a
   * draft so a promoted piece's new element (Flow, Hot Foot) counts. `viewer` judges the actor's
   * king with public knowledge only when it is not the actor (DD-19).
   */
  private bonusExposesActor(m: number, viewer: Side): boolean {
    return this.inv03Verdict({ chess: m }, viewer) === 'fails';
  }

  /** Legal bonus moves for `owner` that also keep the acting player's ordinary king safe (INV-03). */
  private bonusOptions(spec: BonusSpec, tc: TCtx): number[] {
    const s = this.s;
    const owner = tc.owner;
    const moves = this.legalFor(owner);
    let allowedFrom: Set<Square> | null = null;
    let captorSq = -1;
    if (spec.capture === 'captor') {
      const captor = s.pieces[tc.cap.captor];
      if (!captor || captor.square < 0) return [];
      captorSq = captor.square;
    } else {
      allowedFrom = new Set<Square>();
      const self = s.pieces[tc.bearer];
      if (self && self.square >= 0 && self.side === owner) allowedFrom.add(self.square);
      if (spec.movers === 'selfOrFriendlyPawn' || spec.movers === 'anyFriendly') {
        for (const p of s.pieces) {
          if (
            p.side === owner &&
            p.square >= 0 &&
            (spec.movers === 'anyFriendly' || p.type === 'pawn')
          )
            allowedFrom.add(p.square);
        }
      }
    }
    const checkActor = owner !== this.actor;
    const out: number[] = [];
    for (const m of moves) {
      if (m & F_CASTLE) continue;
      if (spec.capture === 'captor') {
        if (!(m & F_CAPTURE) || m & F_EP || mTo(m) !== captorSq) continue;
      } else {
        if (m & F_CAPTURE) continue;
        if (!allowedFrom?.has(mFrom(m))) continue;
      }
      if (checkActor && this.bonusExposesActor(m, owner)) continue;
      out.push(m);
    }
    return out;
  }

  private fxBonus(spec: BonusSpec, tc: TCtx): boolean {
    if (this.depth >= 1) {
      // INV-01: bonus actions cannot grant further bonus actions (DD-12).
      this.fizzle(tc, 'bonusAction', 'bonus_in_bonus', undefined, {
        kind: 'rule',
        id: 'bonus_in_bonus',
      });
      return false;
    }
    if (spec.capture === 'captor' && this.depth + 1 > this.rt.caps.MAX_CHAIN_DEPTH) {
      this.fizzle(tc, 'bonusAction', 'depth_limit', undefined, { kind: 'rule', id: 'depth' });
      return false;
    }
    if (spec.movers === 'self' && spec.capture === 'none') {
      const self = this.s.pieces[tc.bearer];
      if (!self || self.square < 0) {
        this.fizzle(tc, 'bonusAction', 'no_body');
        return false;
      }
    }
    const moves = this.bonusOptions(spec, tc);
    if (moves.length === 0) {
      this.fizzle(tc, 'bonusAction', 'no_target');
      return false;
    }
    const keyed = moves.map((m) => ({
      m,
      key: relOrder(tc.owner, mFrom(m)) * 64 * 8 + relOrder(tc.owner, mTo(m)) * 8 + (7 - mPromo(m)),
    }));
    keyed.sort((a, b) => a.key - b.key);
    const options: ChoiceOption[] = keyed.map(({ m }) => {
      const mv = decodeMove(m);
      return mv.promotion
        ? { kind: 'move', from: mv.from, to: mv.to, promotion: mv.promotion }
        : { kind: 'move', from: mv.from, to: mv.to };
    });
    const choice = this.choose(tc.owner, 'bonusMove', options, tc, spec.optional);
    if (!choice || choice.kind !== 'move') return false;
    const idx = options.findIndex((o) => sameOption(o, choice));
    const m = (keyed[idx] as { m: number }).m;
    this.revealStalwartIfRelaxed(m, tc.owner);
    if (tc.owner !== this.actor && this.inv03Verdict({ chess: m }, null) === 'relaxed') {
      // The opponent's bonus capture leaves the actor's Stalwart king in check: observable (DD-32).
      this.revealStalwartOf(this.actor);
    }
    this.runMove(m, this.depth + 1, tc.owner, true);
    return true;
  }

  // ---- conditions --------------------------------------------------------------------------------

  private evalCond(c: EffectCondition, tc: TCtx): boolean {
    if ('survives' in c) {
      const id =
        c.survives === 'captor'
          ? tc.cap.captor
          : c.survives === 'victim'
            ? tc.cap.victim
            : tc.bearer;
      return (this.s.pieces[id]?.square ?? -1) >= 0;
    }
    if ('noLegalCapturerOf' in c) {
      // A captor already off the board (for example taken by the Riposte itself) is not "uncapturable".
      const captor = this.s.pieces[tc.cap.captor];
      if (!captor || captor.square < 0) return false;
      return (
        this.bonusOptions({ movers: 'anyFriendly', capture: 'captor', optional: true }, tc)
          .length === 0
      );
    }
    if ('typeIs' in c) {
      const id =
        c.typeIs.of === 'captor'
          ? tc.cap.captor
          : c.typeIs.of === 'victim'
            ? tc.cap.victim
            : tc.bearer;
      const p = this.s.pieces[id];
      return p !== undefined && c.typeIs.types.includes(p.type);
    }
    if ('not' in c) return !this.evalCond(c.not, tc);
    return c.all.every((x) => this.evalCond(x, tc));
  }

  // ---- intercepts (effectIntercept, 13.5) ---------------------------------------------------------

  /**
   * Engine invariants first (Royal Immunity, INV-03), then traits, items and abilities (hooks), then
   * PROTECT registrations from abilities. The first fizzle wins; later interceptors are not consumed.
   */
  private intercept(info: EffectInfo): { reason: FizzleReason; source: SourceRef } | null {
    if (info.kind === 'effectCapture' && info.target.type === 'king') {
      return { reason: 'royal_immunity', source: { kind: 'rule', id: 'royal_immunity' } };
    }
    const change: Change =
      info.kind === 'effectCapture'
        ? { remove: info.target.id }
        : info.kind === 'move'
          ? { move: { id: info.target.id, to: info.to as Square } }
          : { place: { id: info.target.id, to: info.to as Square } };
    const inv03 = this.inv03Verdict(change, null);
    if (inv03 === 'fails') return { reason: 'inv03', source: { kind: 'rule', id: 'inv03' } };
    for (const e of this.rt.hook(this.s, 'effectIntercept')) {
      const v = e.hooks.effectIntercept?.(this.rt.ctx(this, e), info);
      if (v && v !== 'allow') {
        this.revealEntry(e, 'observed');
        return { reason: v.fizzle, source: sourceOf(e) };
      }
    }
    if (info.kind === 'effectCapture') {
      const prot = this.protections.find((p) => p.piece === info.target.id && p.remaining > 0);
      if (prot) {
        prot.remaining--;
        return { reason: 'protected', source: prot.source };
      }
    }
    // Only an effect that really resolves makes a relaxed (Stalwart) king observable (DD-32).
    if (inv03 === 'relaxed') this.revealStalwartOf(this.actor);
    return null;
  }

  /**
   * INV-03 verdict for a change: 'ok' when the acting player's king stays safe, 'fails' when an
   * ordinary king would be left in check, 'relaxed' when only a Stalwart king is. The change is
   * applied to a draft and movement rules are recomputed there (revived and promoted pieces bring
   * their own Flow and Hot Foot). `viewer` null judges with the true state; otherwise the actor's
   * king counts as Stalwart only if the viewer is the actor or Stalwart is already revealed, so
   * option lists never leak it (DD-19, DD-46, R-SEC-001).
   */
  private inv03Verdict(change: Change, viewer: Side | null): 'ok' | 'fails' | 'relaxed' {
    const sim = simulate(this.rt, this.s, change);
    const actorCode = sideCode(this.actor);
    if (!sim.pos.inCheck(actorCode)) return 'ok';
    const src = this.stalwartSource(this.actor);
    const relaxed =
      src !== null &&
      (viewer === null ||
        viewer === this.actor ||
        (this.s.reveals[this.actor].abilities.king ?? []).includes(src.id));
    return relaxed ? 'relaxed' : 'fails';
  }

  private revealStalwartOf(side: Side): void {
    const src = this.stalwartSource(side);
    if (!src) return;
    this.reveal(
      side,
      { kind: 'ability', pieceType: 'king', ability: src.id },
      'observed',
      sourceOf(src),
    );
  }

  // ---- Stalwart observation (DD-32) ---------------------------------------------------------------

  /** The module that makes `side`'s king Stalwart; works for a king that was just captured. */
  private stalwartSource(side: Side): HookEntry | null {
    const king = this.s.pieces.find((p) => p.side === side && p.type === 'king');
    if (!king) return null;
    const view = this.rt.view(this, king.id);
    for (const e of this.rt.hook(this.s, 'moveFilter')) {
      if (e.hooks.moveFilter?.kingMode?.(this.rt.ctx(this, e), view) === 'stalwart') return e;
    }
    return null;
  }

  private revealStalwartIfRelaxed(m: number, side: Side): void {
    if (!this.stalwartSource(side)) return;
    // Would this move be illegal for an ordinary king? Only `side`'s own flag is turned off (DD-32).
    const strict = this.positionFor(side, side);
    if (strict.legal(sideCode(side)).includes(m)) return;
    this.revealStalwartOf(side);
  }

  // ---- Settle (phase 5) --------------------------------------------------------------------------

  private settle(): void {
    const s = this.s;
    const mover = this.actor;
    s.halfmove = this.irreversible ? 0 : s.halfmove + 1;
    if (mover === 'black') s.fullmove++;
    s.ply++;
    s.turn = opposite(mover);
    for (const e of this.rt.hook(s, 'onTurnEnd'))
      e.hooks.onTurnEnd?.(this.rt.ctx(this, e), { side: mover });
    this.emit({ k: 'TurnPassed', side: s.turn, ply: s.ply });

    const next = s.turn;
    const defeated = new Set<Side>(this.stalwartCaptured);
    const kingSources = new Map<Side, HookEntry>();
    const rules = this.rt.moveRules(this, kingSources);
    const pos = Pos.fromState(s, rules);
    // The next player's own king safety is judged as their own turn will end (R-ELEM-005).
    pos.safety = rulesAfterTurnEnd(this.rt, s, next);
    const nextCode = sideCode(next);
    let nextLegal = -1;
    let nextInCheck = false;
    if (!defeated.has(next)) {
      nextInCheck = pos.inCheck(nextCode);
      nextLegal = pos.legal(nextCode).length;
      if (nextLegal === 0 && nextInCheck && !rules.stalwart[nextCode]) defeated.add(next);
      if (rules.stalwart[nextCode] && nextInCheck && !defeated.has(mover)) {
        // Would-be checkmate survived: Stalwart is observable (DD-32).
        const stalwart: [boolean, boolean] = [rules.stalwart[0], rules.stalwart[1]];
        stalwart[nextCode] = false;
        const strict = Pos.fromState(s, { ...rules, stalwart });
        if (strict.legal(nextCode).length === 0) {
          const src = kingSources.get(next);
          if (src)
            this.reveal(
              next,
              { kind: 'ability', pieceType: 'king', ability: src.id },
              'observed',
              sourceOf(src),
            );
        }
      }
    }
    const moverCode = mover === 'white' ? WHITE : BLACK;
    const moverInCheck = !defeated.has(mover) && pos.inCheck(moverCode);
    s.inCheck = nextInCheck ? next : moverInCheck ? mover : null;
    if (nextInCheck) this.emitCheck(next);
    if (moverInCheck) this.emitCheck(mover);

    // Repetition bookkeeping (full engine state, 4.5).
    const hash = this.rt.stateHash(s);
    s.repetition = this.irreversible ? [hash] : [...s.repetition, hash];

    let result: BattleResult | null = null;
    if (defeated.size === 2) {
      result = { winner: null, reason: 'double_royal_defeat' };
    } else if (defeated.size === 1) {
      const loser = [...defeated][0] as Side;
      result = {
        winner: opposite(loser),
        reason: this.stalwartCaptured.has(loser) ? 'stalwart_captured' : 'checkmate',
      };
    } else if (this.objectiveWinner) {
      // R-FMT-002: royal defeat outranks the format objective; otherwise the earliest qualifying capture.
      result = { winner: this.objectiveWinner, reason: 'objective' };
    } else if (nextLegal === 0) {
      result = { winner: null, reason: 'stalemate' };
    } else if (s.halfmove >= 100) {
      result = { winner: null, reason: 'fifty_move' };
    } else if (s.repetition.filter((h) => h === hash).length >= 3) {
      result = { winner: null, reason: 'repetition' };
    }
    if (result) {
      s.result = result;
      this.emit({ k: 'BattleEnded', result });
    }
  }

  private emitCheck(side: Side): void {
    const king = this.s.pieces.find((p) => p.side === side && p.type === 'king' && p.square >= 0);
    if (king) this.emit({ k: 'Check', side, square: king.square });
  }
}

export { encodeMove };
