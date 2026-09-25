# Playtest Gate 1

Spec section 16 (after M3): _"the designer confirms or changes the silence rule, element traits and
starter abilities before any server work."_ The build does not wait for the designer (BUILD_PROMPT 6);
this report gives the designer the evidence, lists what was tuned (nothing COMMITTED), and ends with a
15-minute checklist to try in the local build.

**Status: simulator targets are partly missed. The build continues to M4; the three questions in
section 4 need the designer's answer.**

## 1. How the numbers were produced

- `pnpm sim` (apps/tools/src/sim): AI versus AI, both sides the Trainer tier at a fixed 2,000-node budget
  per move (deterministic), each side searching only its own projection. Colours alternate within every
  pairing; draws count as half a win. Level 25 for every army.
- **Element suite:** mono-element "Focused" builds (Headmaster Ring, Resonance Crystal, Scout's Lens,
  five abilities). `--pool any` ranks every ability (off-element picks allowed, as a player would);
  `--pool affinity` restricts each element to its own and neutral abilities (pure element identity).
- **Archetype suite:** the four builds of spec 7.3 (Maximum, Flexible, Focused, Starter) with the same
  element pair per game.
- Sample sizes: 120 games per pairing in First Blood, 40 (elements) or 24 (archetypes) in Full Battle.
  At 40 games a score has roughly ±8 points of noise; at 120, ±5.
- Reproduce any table with the command shown under it; raw results are written to `reports/sim/`.

Caveat: the NPC is a shallow searcher with approximate ability knowledge below the root (docs/ARCHITECTURE
section 4). Human play will differ, especially for bluffing and probing. Treat these as directional.

## 2. Results against the 17.2 targets

### 2.1 Element advantage (target: advantaged element 55–60%)

Row element's score against the column element.

**First Blood, silence `ALL_TRIGGERS` (current), pool `any`** — `pnpm sim --suite elements --format first_blood --games 120`

| Row vs column | ember               | tide                | grove               |
| ------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 52.5% | 5.8%                | 50.0%               |
| tide          | 94.2%               | mirror, white 65.8% | 40.8%               |
| grove         | 50.0%               | 59.2%               | mirror, white 55.8% |

Advantaged element: **67.8%**. White: 55.7%. Surprise losses: 29.9%. Median 15 plies.

**Full Battle, `ALL_TRIGGERS`, pool `affinity`** — `pnpm sim --suite elements --format full --games 40 --pool affinity`

| Row vs column | ember               | tide                | grove               |
| ------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 48.8% | 15.0%               | 72.5%               |
| tide          | 85.0%               | mirror, white 61.3% | 1.3%                |
| grove         | 27.5%               | 98.8%               | mirror, white 60.0% |

Advantaged element: **85.4%**. White: 54.4%. Median 63 plies.

**The silenceScope knob (6.2), Full Battle, pool `affinity`:**

| silenceScope             | Ember→Grove | Grove→Tide | Tide→Ember | Advantaged element |
| ------------------------ | ----------- | ---------- | ---------- | ------------------ |
| `ALL_TRIGGERS` (default) | 72.5%       | 98.8%      | 85.0%      | 85.4%              |
| `REACTIONS_ONLY`         | 63.7%       | 77.5%      | 85.0%      | 75.4%              |
| `OFF` (test only)        | 2.5%        | 36.3%      | 56.3%      | 27.5%              |

The same comparison with pool `any`: 81.7% (`ALL_TRIGGERS`) and 78.8% (`REACTIONS_ONLY`). In First
Blood, `REACTIONS_ONLY` gives 66.4% (affinity) and 68.3% (any) against 66.4% and 67.8% with
`ALL_TRIGGERS`.

### 2.2 Builds (target: Maximum, Flexible, Focused each 45–55% against the others)

**First Blood** — `pnpm sim --suite archetypes --format first_blood --games 60`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 56.7%    | 61.7%   | 75.0%   |
| flexible      | 43.3%   | —        | 50.0%   | 58.3%   |
| focused       | 38.3%   | 50.0%    | —       | 75.0%   |
| starter       | 25.0%   | 41.7%    | 25.0%   | —       |

**Full Battle** — `pnpm sim --suite archetypes --format full --games 24`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 62.5%    | 50.0%   | 81.3%   |
| flexible      | 37.5%   | —        | 52.1%   | 60.4%   |
| focused       | 50.0%   | 47.9%    | —       | 91.7%   |
| starter       | 18.8%   | 39.6%    | 8.3%    | —       |

Flexible and Focused are balanced (48–52%). Maximum is slightly strong (50–62%, inside noise for Full
against Focused). Starter losing is expected: it is the level-1 build.

### 2.3 Other targets

| Metric                                          | Target    | Simulator                                                             | Verdict                      |
| ----------------------------------------------- | --------- | --------------------------------------------------------------------- | ---------------------------- |
| White win rate                                  | ≤ 56%     | 49–56% overall; Tide mirror 66–88% in First Blood, 61% in Full Battle | Met overall; see Flow below  |
| Surprise losses                                 | < 15%     | 24–37% First Blood, 0–7% Full Battle                                  | Missed in First Blood        |
| Single ability pick rate in top ranked loadouts | < 40%     | needs live ranked data                                                | Not measurable yet           |
| First Blood median length                       | 2–5 min   | 15 plies (about 7 moves each)                                         | Plausible at live move times |
| Full Battle median length                       | 10–25 min | 35–63 plies                                                           | Plausible                    |
| New player first win                            | < 30 min  | needs the M5 tutorial                                                 | Not measurable yet           |

## 3. What the data says

1. **Silence decides whole games, not single captures.** With `ALL_TRIGGERS`, every capture the
   disadvantaged element takes part in turns its abilities off, while all of the advantaged side's
   abilities still fire. Over a Full Battle that compounds to 72–99% for the advantaged side with pure
   element kits (target 55–60%). `REACTIONS_ONLY`, the spec's suggested first test, only spares the
   captor's Capturing abilities and moves the average by about 10 points in Full Battle and 0 in First
   Blood: not enough on its own.
2. **Ability kits are not equally strong.** With silence off, Grove's kit beats Ember's 97.5% and Tide's
   beats Grove's 64%. Ember reaches only 50% against Grove even with the advantage, so Ember is the
   weakest element in both formats. Grove's Poisoned Meat is the single most decisive card in First Blood:
   it turns any non-pawn capture of a pawn into a loss for the captor (E4).
3. **Flow gives a first-move race in the Tide mirror.** Tide rooks, bishops and queens attack through
   their own pawns from move one, so in First Blood the side that moves first wins the resulting race
   (White scores 66–88% in the Tide mirror, depending on the pool). Other mirrors stay within 52–56%.
4. **Surprise losses are high in First Blood** because one capture decides the game and most abilities
   are unknown at that point. Full Battle is fine (0–7%). The spec's guidance applies: add reveal tools
   before adding hidden power.
5. **Builds are close to target.** The item catalogue already keeps Flexible and Focused level with each
   other; Maximum has a small edge.

## 4. Tuning decisions and questions for the designer

**PLAYTEST values tuned in this gate: none.** Every lever that moves the element numbers enough is a
COMMITTED rule (the silence rule D-21, the Flow and First Blood rules D-40 and R-FMT-001) or a
starter-ability redesign large enough that it should be the designer's call. Specifically:

- `silenceScope` stays `ALL_TRIGGERS`. `REACTIONS_ONLY` was tested (above) and helps too little to
  justify the extra rule nuance; switching it is a one-line change in `packages/content/config.ts`.
- Charges and level requirements stay at the spec values: the imbalances are between elements, not
  between levels, and changing charges would not address them.

Questions for the designer (each has a ready-to-test option):

1. **Silence strength.** Keep "silence every trigger of the weaker piece" (D-21) or soften it? Options to
   test, in order of how much of the rule they keep: (a) silence only the disadvantaged piece's
   _Captured_ abilities; (b) the advantaged side's Resonance Crystal-like first-silence immunity for every
   army; (c) silence only one ability (the first in loadout order) per capture. Each is a small engine
   change behind `silenceScope`, and the simulator can compare them in minutes.
2. **Ember's kit.** Ember needs more power or Grove less. Ready-to-test candidates: Cleave's attuned
   bonus by default (any adjacent pawn), Backdraft able to hit knights and bishops unattuned, Momentum at
   3 charges; or Poisoned Meat limited to non-pawn victims in First Blood.
3. **Flow at the start.** Accept the Tide mirror first-move edge in First Blood, or limit Flow to pieces
   that have moved at least once (a narrow change to R-ELEM-006, which is COMMITTED).

Other recommendations: add one cheap reveal tool to the starter catalogue (for example a level-1 item
that reveals the opponent's first ability in the knight set) to bring First Blood surprise losses toward
15%; revisit Maximum's edge once real ranked data exists.

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
