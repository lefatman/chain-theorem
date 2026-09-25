# Playtest Gate 1

Spec section 16 (after M3): _"the designer confirms or changes the silence rule, element traits and
starter abilities before any server work."_ The build does not wait for the designer (BUILD_PROMPT 6);
this report gives the designer the evidence, lists what was tuned (nothing COMMITTED), and ends with a
15-minute checklist to try in the local build.

**Status: simulator targets are partly missed (element advantage 72–75% against 55–60%; Tide mirror
first-move edge). The build continues to M4; the three questions in section 4 need the designer's
answer.**

## 1. How the numbers were produced

- `pnpm sim` (apps/tools/src/sim): AI versus AI, both sides the Trainer tier (depth 3, ability-aware)
  with a fixed budget of 20,000 nodes per move, so every game is deterministic; each side searches
  only its own projection. Colours alternate within every pairing; draws count as half a win. Every
  army is level 25. Each game's seed varies the Trainer's small evaluation noise (8 centipawns), so
  mirror pairings are the least varied samples.
- **Element suite:** mono-element "Focused" builds (Headmaster Ring, Resonance Crystal, Scout's Lens,
  five abilities). `--pool any` ranks every ability, off-element picks included, as a player would.
  `--pool affinity` restricts each element to its own and neutral abilities (pure element identity).
- **Archetype suite:** the four builds of spec 7.3 (Maximum, Flexible, Focused, Starter) with the same
  element pair per game.
- Sample sizes: 120 games per pairing in First Blood, 40 (elements) or 24 (archetypes) in Full Battle.
  At 40 games a score has roughly ±8 points of noise; at 120, ±5.
- Reproduce any table with the command shown under it; raw results are written to `reports/sim/`.
- These tables replace the first run of this report. That run came from an NPC that overshot its node
  budget. Since the M3 AI fixes the budget is exact, and the Trainer's depth, not its node budget,
  limits the search.

Caveat: the NPC is a shallow searcher with approximate ability knowledge below the root
(docs/ARCHITECTURE section 4). Human play will differ, especially for bluffing and probing. Treat these
numbers as directional.

## 2. Results against the 17.2 targets

### 2.1 Element advantage (target: advantaged element 55–60%)

Row element's score against the column element.

**First Blood, silence `ALL_TRIGGERS` (current), pool `any`** —
`pnpm sim --suite elements --format first_blood --games 120 --nodes 20000`

| Row vs column | ember               | tide                | grove               |
| ------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 25.0% | 0.0%                | 64.6%               |
| tide          | 100.0%              | mirror, white 97.5% | 48.3%               |
| grove         | 35.4%               | 51.7%               | mirror, white 46.7% |

Advantaged element: **72.1%**. White: 52.6%. Surprise losses: 29.1%. Median 12 plies.

**Full Battle, `ALL_TRIGGERS`, pool `affinity`** —
`pnpm sim --suite elements --format full --games 40 --pool affinity --nodes 20000`

| Row vs column | ember               | tide                | grove               |
| ------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 43.8% | 2.5%                | 31.3%               |
| tide          | 97.5%               | mirror, white 97.5% | 2.5%                |
| grove         | 68.8%               | 97.5%               | mirror, white 55.0% |

Advantaged element: **75.4%**. White: 59.6%. Median 53 plies.

**The silenceScope knob (6.2), Full Battle, pool `affinity`** (add `--silence <scope>`):

| silenceScope             | Ember→Grove | Grove→Tide | Tide→Ember | Advantaged element |
| ------------------------ | ----------- | ---------- | ---------- | ------------------ |
| `ALL_TRIGGERS` (default) | 31.3%       | 97.5%      | 97.5%      | 75.4%              |
| `REACTIONS_ONLY`         | 68.8%       | 88.8%      | 97.5%      | 85.0%              |
| `OFF` (test only)        | 5.0%        | 0.0%       | 98.8%      | 34.6%              |

With silence `OFF` the kits alone decide: Tide beats Ember 98.8% and Grove 100%, and Grove beats Ember
95%.

### 2.2 Builds (target: Maximum, Flexible, Focused each 45–55% against the others)

**First Blood** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 55.0%    | 55.0%   | 86.7%   |
| flexible      | 45.0%   | —        | 60.0%   | 63.3%   |
| focused       | 45.0%   | 40.0%    | —       | 65.0%   |
| starter       | 13.3%   | 36.7%    | 35.0%   | —       |

**Full Battle** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 52.1%    | 70.8%   | 89.6%   |
| flexible      | 47.9%   | —        | 66.7%   | 79.2%   |
| focused       | 29.2%   | 33.3%    | —       | 85.4%   |
| starter       | 10.4%   | 20.8%    | 14.6%   | —       |

Maximum and Flexible are level (48–55%). Focused meets the target in First Blood (40–45%) but falls
behind in Full Battle (29–33%, from 24 games, so about ±10 points). The Starter build losing is
expected: it is the level-1 build.

### 2.3 Other targets

| Metric                                          | Target    | Simulator                                                               | Verdict                      |
| ----------------------------------------------- | --------- | ----------------------------------------------------------------------- | ---------------------------- |
| White win rate                                  | ≤ 56%     | 50–53% overall in First Blood, 52–60% in Full Battle; Tide mirror 97.5% | Missed in the Tide mirror    |
| Surprise losses                                 | < 15%     | 28–29% First Blood, 0–2% Full Battle                                    | Missed in First Blood        |
| Single ability pick rate in top ranked loadouts | < 40%     | needs live ranked data                                                  | Not measurable yet           |
| First Blood median length                       | 2–5 min   | 12–13 plies (about 6 moves each)                                        | Plausible at live move times |
| Full Battle median length                       | 10–25 min | 53–57 plies                                                             | Plausible                    |
| New player first win                            | < 30 min  | needs the M5 tutorial                                                   | Not measurable yet           |

## 3. What the data says

1. **The starter kits are far apart, and Tide's is the strongest.** With silence off, Tide beats both
   other elements 99–100%, and Grove beats Ember 95%. Flow (attacking through your own pieces) plus
   Hit and Run and Pierce gives Tide early tactics the others cannot answer. The advantage wheel then
   only decides who wins between Grove and Tide (Grove silences Tide: 97.5% for Grove).
2. **Silence swings whole games.** With `ALL_TRIGGERS`, the advantaged side scores 75% overall. The
   spread by pairing is wide: from 31% for Ember against Grove, whose kit is stronger, to 97.5% for
   Grove against Tide. `REACTIONS_ONLY` does not help (85%): the kits, not the silence rule, set most
   of the imbalance.
3. **Flow gives a first-move race in the Tide mirror.** Tide rooks, bishops and queens attack through
   their own pawns from move one, and the side that starts the race wins it: White scores 97.5% in the
   Tide mirror in both formats. The other mirrors stay within 25–55%.
4. **Ember is the weakest element.** It loses to Tide outright and beats Grove only in First Blood
   (64.6%). In Full Battle, Grove's kit overcomes the silence (Ember 31% despite the advantage).
5. **Surprise losses are high in First Blood** because one capture decides the game and most abilities
   are unknown at that point. Full Battle is fine (0–2%). The spec's guidance applies: add reveal tools
   before adding hidden power.
6. **Builds are close to target in First Blood.** In Full Battle, Focused (one element, five
   abilities) trails Maximum and Flexible, which carry two elements and more items.

## 4. Tuning decisions and questions for the designer

**PLAYTEST values tuned in this gate: none.** Every lever that moves the element numbers enough is a
COMMITTED rule (the silence rule D-21, the Flow and First Blood rules D-40 and R-FMT-001) or a
starter-ability redesign large enough that it should be the designer's call. Specifically:

- `silenceScope` stays `ALL_TRIGGERS`. `REACTIONS_ONLY` was tested (above) and did not help (85% against
  75%); switching it is a one-line change in `packages/content/config.ts`.
- Charges and level requirements stay at the spec values: the imbalances are between elements, not
  between levels, and changing charges would not address them.

Questions for the designer (each has a ready-to-test option):

1. **Silence strength.** Keep "silence every trigger of the weaker piece" (D-21) or soften it? The data
   says the kits matter more than the silence rule (section 3), so rebalance the kits first and re-run
   this table. Options to test afterwards, in order of how much of the rule they keep: (a) silence only
   the disadvantaged piece's _Captured_ abilities; (b) the advantaged side's Resonance Crystal-like
   first-silence immunity for every army; (c) silence only one ability (the first in loadout order) per
   capture. Each is a small engine change behind `silenceScope`, and the simulator compares them in
   minutes.
2. **Tide's and Ember's kits.** Tide needs less early reach and Ember more power. Ready-to-test
   candidates: Hit and Run's attuned landing limited to the origin square, Pierce not usable on the
   first move; for Ember, Cleave's attuned bonus by default (any adjacent pawn), Backdraft able to hit
   knights and bishops unattuned, Momentum at 3 charges.
3. **Flow at the start.** Accept the Tide mirror first-move edge, or limit Flow to pieces that have
   moved at least once (a narrow change to R-ELEM-006, which is COMMITTED). The mirror result (97.5% for
   White) makes this the most urgent question.

Other recommendations: add one cheap reveal tool to the starter catalogue (for example a level-1 item
that reveals the opponent's first ability in the knight set) to bring First Blood surprise losses toward
15%; revisit Focused's Full Battle deficit once real ranked data exists.

## 5. The 15-minute checklist (local build)

Run `pnpm install && pnpm --filter @chain-theorem/client dev` and open the printed URL.

| Minute | Try this                                                                               | Look for                                                                                          |
| ------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 0–2    | Play → First Blood vs Wild NPC with **Grove Starter**                                  | The first non-pawn capture ends the game; Poisoned Meat on your pawns punishes the NPC's captures |
| 2–4    | Same, but your pawns take their pawns with a piece while the NPC has **Grove Starter** | E4: capturing a Poisoned Meat pawn with a non-pawn loses First Blood                              |
| 4–6    | Full Battle, you **Tide Skirmisher** vs NPC **Ember Raider** (Trainer)                 | Tide silences Ember's reactions (log says "silenced"); how one-sided does it feel?                |
| 6–8    | Full Battle, you **Ember Raider** vs NPC **Grove Starter**                             | Ember's advantage: Poisoned Meat and Rebirth silenced; does Ember still feel weak?                |
| 8–10   | Scenario Lab (dev build) → E7 and E8                                                   | Hot Foot flame with its turn counter; Tide rook giving check through its own pawn                 |
| 10–12  | Build a Tide army and move a rook through its own pawn on move 1                       | Flow's first-move reach (question 3)                                                              |
| 12–14  | Loadouts → try Maximum, Flexible and Focused at level 25                               | Slot meters, capacity, rule errors; does the budget feel like a real choice?                      |
| 14–15  | Settings → Classic View, fast mode                                                     | Readability of role, owner, element and status at a glance (R-ART-002)                            |

After playing, answer the three questions in section 4 in `docs/DESIGN.md` section 18 (or tell the
agent), and set the Status of this gate to passed.
