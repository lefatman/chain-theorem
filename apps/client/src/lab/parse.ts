/**
 * Custom Scenario Lab setups: a FEN, a format, one JSON army per side, scripted UCI moves and prompt
 * answers, edited as text and parsed into a scenario() spec. Shape problems are errors (the battle
 * cannot start); real-play loadout rules (R-LOAD-004) are only warnings, because the lab, like the
 * golden tests, allows 'neutral' elements and any ability mix (DD-23).
 */
import type { Engine, ElementId, FormatId, Loadout } from '@chain-theorem/rules';
import { ELEMENTS, START_FEN, parseFen, parseSquare, squareName } from '@chain-theorem/rules';
import { CAPS, abilityById, itemById } from '@chain-theorem/content';
import {
  type Answer,
  type ArmySpec,
  type ScenarioSpec,
  loadoutOf,
} from '@chain-theorem/content/testing';
import { errorText, startSession } from './session.ts';

export interface CustomDraft {
  fen: string;
  format: FormatId;
  white: string;
  black: string;
  moves: string;
  answers: string;
}

export type DraftField = keyof CustomDraft;

export interface Issue {
  level: 'error' | 'warning';
  text: string;
}

export interface ParsedDraft {
  /** The spec, or null when any field has an error. */
  spec: ScenarioSpec | null;
  issues: Record<DraftField, Issue[]>;
}

export const FORMATS: readonly FormatId[] = ['first_blood', 'vanguard', 'full'];
const ALL_ELEMENTS: readonly ElementId[] = [...ELEMENTS, 'neutral'];
const ARMY_KEYS = ['level', 'elements', 'items', 'itemParams', 'sets', 'abilities'] as const;
const UCI = /^[a-h][1-8][a-h][1-8][nbrq]?$/;

const err = (text: string): Issue => ({ level: 'error', text });
const warn = (text: string): Issue => ({ level: 'warning', text });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function stringList(v: unknown, what: string, issues: Issue[]): string[] | null {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    issues.push(err(`${what} must be an array of strings.`));
    return null;
  }
  return v as string[];
}

function abilityList(v: unknown, what: string, issues: Issue[]): string[] | null {
  const list = stringList(v, what, issues);
  if (!list) return null;
  const unknown = list.filter((id) => !abilityById.has(id));
  if (unknown.length > 0) {
    issues.push(err(`${what}: unknown ability ${unknown.map((u) => `'${u}'`).join(', ')}.`));
    return null;
  }
  return list;
}

/** Parse one side's army JSON: { level, elements, items, itemParams, sets | abilities }. */
export function parseArmy(
  text: string,
  engine: Engine,
): { army: ArmySpec | null; issues: Issue[] } {
  const issues: Issue[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim() === '' ? '{}' : text);
  } catch (e) {
    return { army: null, issues: [err(`Not valid JSON: ${errorText(e)}`)] };
  }
  if (!isRecord(raw)) return { army: null, issues: [err('The army must be a JSON object.')] };
  const army: ArmySpec = {};
  for (const key of Object.keys(raw)) {
    if (!(ARMY_KEYS as readonly string[]).includes(key))
      issues.push(err(`Unknown key '${key}'. Use ${ARMY_KEYS.join(', ')}.`));
  }
  if (raw.level !== undefined) {
    const level = raw.level;
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1)
      issues.push(err('level must be a whole number of at least 1.'));
    else {
      army.level = level;
      if (level > CAPS.LEVEL_CAP) issues.push(warn(`level is above the cap (${CAPS.LEVEL_CAP}).`));
    }
  }
  if (raw.elements !== undefined) {
    const els = stringList(raw.elements, 'elements', issues);
    if (els) {
      const bad = els.filter((e) => !(ALL_ELEMENTS as readonly string[]).includes(e));
      if (bad.length > 0)
        issues.push(err(`Unknown element ${bad.join(', ')}. Use ${ALL_ELEMENTS.join(', ')}.`));
      else if (els.length < 1 || els.length > 2)
        issues.push(err('elements needs 1 element, or 2 with Blended Family.'));
      else army.elements = els as ElementId[];
    }
  }
  if (raw.items !== undefined) {
    const list = stringList(raw.items, 'items', issues);
    if (list) {
      const unknown = list.filter((id) => !itemById.has(id));
      if (unknown.length > 0)
        issues.push(err(`Unknown item ${unknown.map((u) => `'${u}'`).join(', ')}.`));
      else army.items = list;
    }
  }
  if (raw.itemParams !== undefined) {
    const params = raw.itemParams;
    if (!isRecord(params)) issues.push(err('itemParams must be an object of { element }.'));
    else {
      const out: NonNullable<ArmySpec['itemParams']> = {};
      for (const [id, v] of Object.entries(params)) {
        const el = isRecord(v) ? v.element : undefined;
        if (!itemById.has(id)) issues.push(err(`itemParams: unknown item '${id}'.`));
        else if (typeof el !== 'string' || !(ELEMENTS as readonly string[]).includes(el))
          issues.push(err(`itemParams.${id}.element must be one of ${ELEMENTS.join(', ')}.`));
        else out[id] = { element: el as ElementId };
      }
      army.itemParams = out;
    }
  }
  if (raw.sets !== undefined && raw.abilities !== undefined)
    issues.push(err('Use either sets or abilities, not both.'));
  if (raw.sets !== undefined) {
    const sets = raw.sets;
    if (!Array.isArray(sets) || (sets.length !== 1 && sets.length !== 6))
      issues.push(
        err('sets must hold 1 army-wide set or 6 sets (pawn, knight, bishop, rook, queen, king).'),
      );
    else {
      const parsed = sets.map((s, i) => abilityList(s, `sets[${i}]`, issues));
      if (parsed.every((s): s is string[] => s !== null)) army.sets = parsed;
    }
  }
  if (raw.abilities !== undefined) {
    const list = abilityList(raw.abilities, 'abilities', issues);
    if (list) army.abilities = list;
  }
  if (issues.some((i) => i.level === 'error')) return { army: null, issues };
  // Real-play rules (R-LOAD-004) only warn here: the lab allows 'neutral' and any ability mix.
  const v = engine.validateLoadout(loadoutOf(army), { level: army.level ?? 30 });
  for (const e of v.errors) issues.push(warn(`Real play would reject this: ${e.message}`));
  if (loadoutOf(army).elements.includes('neutral'))
    issues.push(warn("'neutral' is for tests and the lab only (DD-23)."));
  return { army, issues };
}

/** UCI moves separated by spaces, commas or new lines. */
export function parseMoves(text: string): { moves: string[] | null; issues: Issue[] } {
  const moves = text
    .split(/[\s,]+/)
    .map((m) => m.trim().toLowerCase())
    .filter((m) => m !== '');
  const bad = moves.filter((m) => !UCI.test(m));
  if (bad.length > 0)
    return {
      moves: null,
      issues: [err(`Not UCI moves: ${bad.join(', ')} (write e2e4, or e7e8q to promote).`)],
    };
  return { moves, issues: [] };
}

function squareField(v: unknown, what: string, issues: Issue[]): number | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 64) return v;
  if (typeof v === 'string' && /^[a-h][1-8]$/.test(v)) return parseSquare(v);
  issues.push(err(`${what} must be a square such as "c1" (or 0..63).`));
  return null;
}

/**
 * Prompt answers as a JSON array, used in order: an option index, or the chosen option itself
 * ({"kind":"decline"}, {"kind":"square","square":"c1"}, {"kind":"piece","piece":4,"square":"g6"},
 * {"kind":"move","from":"h7","to":"g6"}). Square names are converted to numbers.
 */
export function parseAnswers(text: string): { answers: Answer[] | null; issues: Issue[] } {
  if (text.trim() === '') return { answers: [], issues: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { answers: null, issues: [err(`Not valid JSON: ${errorText(e)}`)] };
  }
  if (!Array.isArray(raw)) return { answers: null, issues: [err('Answers must be a JSON array.')] };
  const issues: Issue[] = [];
  const answers: Answer[] = [];
  raw.forEach((a: unknown, i) => {
    const at = `answers[${i}]`;
    if (typeof a === 'number' && Number.isInteger(a) && a >= 0) {
      answers.push(a);
      return;
    }
    if (!isRecord(a)) {
      issues.push(err(`${at} must be an option index or an option object.`));
      return;
    }
    switch (a.kind) {
      case 'decline':
        answers.push({ kind: 'decline' });
        return;
      case 'square': {
        const square = squareField(a.square, `${at}.square`, issues);
        if (square !== null) answers.push({ kind: 'square', square });
        return;
      }
      case 'piece': {
        const square = squareField(a.square, `${at}.square`, issues);
        if (typeof a.piece !== 'number' || !Number.isInteger(a.piece))
          issues.push(err(`${at}.piece must be a piece id.`));
        else if (square !== null) answers.push({ kind: 'piece', piece: a.piece, square });
        return;
      }
      case 'move': {
        const from = squareField(a.from, `${at}.from`, issues);
        const to = squareField(a.to, `${at}.to`, issues);
        const promo = a.promotion;
        if (promo !== undefined && !['knight', 'bishop', 'rook', 'queen'].includes(String(promo)))
          issues.push(err(`${at}.promotion must be knight, bishop, rook or queen.`));
        else if (from !== null && to !== null)
          answers.push(
            promo === undefined
              ? { kind: 'move', from, to }
              : {
                  kind: 'move',
                  from,
                  to,
                  promotion: promo as 'knight' | 'bishop' | 'rook' | 'queen',
                },
          );
        return;
      }
      default:
        issues.push(err(`${at}.kind must be decline, square, piece or move.`));
    }
  });
  return issues.length > 0 ? { answers: null, issues } : { answers, issues };
}

/** Parse and validate the whole draft; the position is checked by actually starting the battle. */
export function parseDraft(draft: CustomDraft, engine: Engine): ParsedDraft {
  const issues: Record<DraftField, Issue[]> = {
    fen: [],
    format: [],
    white: [],
    black: [],
    moves: [],
    answers: [],
  };
  const fen = draft.fen.trim() === '' ? START_FEN : draft.fen.trim();
  try {
    parseFen(fen);
  } catch (e) {
    issues.fen.push(err(errorText(e)));
  }
  if (!FORMATS.includes(draft.format)) issues.format.push(err(`Unknown format ${draft.format}.`));
  const white = parseArmy(draft.white, engine);
  const black = parseArmy(draft.black, engine);
  issues.white.push(...white.issues);
  issues.black.push(...black.issues);
  const moves = parseMoves(draft.moves);
  issues.moves.push(...moves.issues);
  const answers = parseAnswers(draft.answers);
  issues.answers.push(...answers.issues);
  const hasError = Object.values(issues).some((list) => list.some((i) => i.level === 'error'));
  if (hasError || !white.army || !black.army || !moves.moves || !answers.answers)
    return { spec: null, issues };
  const spec: ScenarioSpec = {
    fen,
    format: draft.format,
    white: white.army,
    black: black.army,
    moves: moves.moves,
    answers: answers.answers,
  };
  try {
    startSession(spec);
  } catch (e) {
    issues.fen.push(err(`The battle cannot start: ${errorText(e)}`));
    return { spec: null, issues };
  }
  return { spec, issues };
}

/** A normalised army object for the editor: level, elements, items, itemParams, sets. */
export function armyObject(spec: ArmySpec | undefined): Record<string, unknown> {
  const l: Loadout = loadoutOf(spec);
  return {
    level: spec?.level ?? 30,
    elements: l.elements,
    items: l.items,
    ...(l.itemParams && Object.keys(l.itemParams).length > 0 ? { itemParams: l.itemParams } : {}),
    sets: l.sets,
  };
}

/** JSON with one top-level key per line and compact values (readable in a small text box). */
export function compactJson(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `  ${JSON.stringify(v)}`).join(',\n')}\n]`;
  }
  if (!isRecord(value)) return JSON.stringify(value);
  const lines = Object.entries(value).map(
    ([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
  );
  return lines.length === 0 ? '{}' : `{\n${lines.join(',\n')}\n}`;
}

/** Answers for the editor: option objects with square names, which read better than numbers. */
function answerForEditor(a: Answer): unknown {
  if (typeof a === 'number' || typeof a === 'function') return typeof a === 'number' ? a : null;
  switch (a.kind) {
    case 'decline':
      return a;
    case 'square':
      return { kind: 'square', square: squareName(a.square) };
    case 'piece':
      return { kind: 'piece', piece: a.piece, square: squareName(a.square) };
    case 'move':
      return {
        kind: 'move',
        from: squareName(a.from),
        to: squareName(a.to),
        ...(a.promotion ? { promotion: a.promotion } : {}),
      };
  }
}

/** Editor text for a spec (worked example, exported session). */
export function draftFromSpec(spec: ScenarioSpec): CustomDraft {
  const answers = (spec.answers ?? []).map(answerForEditor);
  return {
    fen: spec.fen ?? START_FEN,
    format: spec.format ?? 'full',
    white: compactJson(armyObject(spec.white)),
    black: compactJson(armyObject(spec.black)),
    moves: (spec.moves ?? []).join(' '),
    answers: answers.length === 0 ? '' : compactJson(answers),
  };
}
