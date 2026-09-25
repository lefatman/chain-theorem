/**
 * Scenario Lab custom setups (BUILD_PROMPT M3): editor text round-trips to the same scenario spec,
 * shape problems are errors, real-play loadout rules (R-LOAD-004) are only warnings (DD-23), and a
 * session can be exported back to a scenario() spec that reproduces it.
 */
import { describe, expect, it } from 'vitest';
import { engine } from '@chain-theorem/content';
import { scenario } from '@chain-theorem/content/testing';
import { WORKED_EXAMPLES } from '../../../../packages/content/src/examples.ts';
import { draftFromSpec, parseAnswers, parseArmy, parseDraft, parseMoves } from './parse.ts';
import { answerPrompt, exportSpec, openPrompt, playMove, runScenario, undo } from './session.ts';

const texts = (list: { text: string }[]) => list.map((i) => i.text).join(' | ');

describe('Scenario Lab custom setup (BUILD_PROMPT M3)', () => {
  for (const ex of WORKED_EXAMPLES) {
    it(`R-TEST-001 ${ex.id} round-trips through the editor text and replays identically`, () => {
      const parsed = parseDraft(draftFromSpec(ex.setup), engine);
      expect(parsed.spec).not.toBeNull();
      const direct = scenario(ex.setup);
      const viaEditor = scenario(parsed.spec ?? {});
      expect(viaEditor.events).toEqual(direct.events);
    });
  }

  it('R-LOAD-004 DD-23 neutral elements and any ability mix are allowed with warnings only', () => {
    const r = parseArmy(
      '{"level": 1, "elements": ["neutral"], "sets": [["stalwart", "rebirth", "veil"]]}',
      engine,
    );
    expect(r.army).not.toBeNull();
    expect(r.issues.every((i) => i.level === 'warning')).toBe(true);
    expect(texts(r.issues)).toMatch(/Real play would reject/);
    expect(texts(r.issues)).toMatch(/neutral/);
  });

  it('rejects malformed armies with readable messages', () => {
    expect(texts(parseArmy('{"elements": ["lava"]}', engine).issues)).toMatch(
      /Unknown element lava/,
    );
    expect(texts(parseArmy('{"sets": [["nope"]]}', engine).issues)).toMatch(
      /unknown ability 'nope'/,
    );
    expect(texts(parseArmy('{"sets": [[], []]}', engine).issues)).toMatch(/1 army-wide set or 6/);
    expect(texts(parseArmy('{"items": ["cape"]}', engine).issues)).toMatch(/Unknown item 'cape'/);
    expect(texts(parseArmy('{"colour": 1}', engine).issues)).toMatch(/Unknown key 'colour'/);
    expect(texts(parseArmy('{"level": 0}', engine).issues)).toMatch(/level/);
    expect(texts(parseArmy('{', engine).issues)).toMatch(/Not valid JSON/);
    expect(parseArmy('{', engine).army).toBeNull();
  });

  it('parses moves and answers, converting square names', () => {
    expect(parseMoves('e2e4, e7e5\n g1f3').moves).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(texts(parseMoves('e2e4 Nf3').issues)).toMatch(/nf3/);
    expect(
      parseAnswers('[0, {"kind":"square","square":"c1"}, {"kind":"move","from":"h7","to":"g6"}]')
        .answers,
    ).toEqual([0, { kind: 'square', square: 2 }, { kind: 'move', from: 55, to: 46 }]);
    expect(texts(parseAnswers('[{"kind":"square","square":"z9"}]').issues)).toMatch(/square/);
  });

  it('reports a position the engine cannot start (one king per side)', () => {
    const draft = draftFromSpec({ fen: '8/8/8/8/8/8/8/4K3 w - - 0 1' });
    const parsed = parseDraft(draft, engine);
    expect(parsed.spec).toBeNull();
    expect(texts(parsed.issues.fen)).toMatch(/exactly one king/);
    expect(texts(parseDraft({ ...draft, fen: 'not a fen' }, engine).issues.fen)).toMatch(/FEN/);
  });

  it('R-ABIL-003 manual hot-seat play with prompts exports to a spec that replays identically', () => {
    const e6 = WORKED_EXAMPLES.find((e) => e.id === 'E6');
    if (!e6) throw new Error('E6 missing');
    // Load the position without its script, then play it by hand, answering the prompt in the lab.
    let s = runScenario({ ...e6.setup, moves: [], answers: [] });
    s = playMove(s, 'd3g6', 'ask');
    const p = openPrompt(s);
    expect(p?.request.chooser).toBe('black');
    const pick = p?.request.options.findIndex((o) => o.kind === 'move' && o.from === 53) ?? -1;
    s = answerPrompt(s, pick);
    expect(openPrompt(s)).toBeNull();
    s = playMove(s, 'e8d8', 'ask');
    const spec = exportSpec(s);
    expect(spec.moves).toEqual(['d3g6', 'e8d8']);
    expect(spec.answers).toEqual([{ kind: 'move', from: 53, to: 46 }]);
    expect(scenario(spec).events).toEqual(s.actions.slice(1).flatMap((a) => a.events));
    // Undo takes back one action at a time.
    expect(undo(s).state).toBe(s.actions[1]?.after);
  });

  it('a failing scripted move stops the run and keeps the actions played so far', () => {
    const s = runScenario({ ...WORKED_EXAMPLES[0]?.setup, moves: ['c3d5', 'a1a2'] });
    expect(s.actions).toHaveLength(2);
    expect(s.error).toMatch(/Scripted move 2 \(a1a2\) failed: illegal_move/);
  });
});
