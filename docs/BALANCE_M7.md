# M7 balance pass: six elements

Step 7.3 enables Storm, Stone and Frost (spec 6.5) and asks for a balance pass against the 17.2
targets (R-TEST-002). As at Playtest Gate 1, the build does not wait for the designer: this report
gives the evidence, lists what was tuned (PLAYTEST values and unreleased M7 cards only; nothing
COMMITTED), and ends with a 15-minute checklist to try in the local build.

**Status: the second triangle's wheel points the right way in every format and pool (Storm beats
Frost, Frost beats Stone, Stone beats Storm: 52–88%). It is near the 55–60% band in First Blood (63%
on average) and above it in Full Battle (73–76%), like the first triangle. Across the triangles the
new elements are level with Ember but lose to Tide in both formats and to Grove in Full Battle: that
is the kit gap of Playtest Gate 1 (its question 2), not the new cards. White score and Full Battle
surprise losses meet the targets; First Blood surprise losses (33%, 55% among new-element builds) and
the Focused build (30–41% in First Blood) still miss. The questions in section 5 need the designer's
answer.**

## 1. How the numbers were produced

- Same simulator and method as Playtest Gate 1 section 1: `pnpm sim`, Trainer tier on both sides,
  20,000 nodes per move (deterministic), colours alternate within a pairing, draws count as half a
  win, every army level 25.
- **All six elements** (`CAPS.ENABLED_ELEMENTS`): 21 element pairings. 60 games per pairing in First
  Blood (about ±6.5 points of noise per cell), 40 in Full Battle (±8). The archetype suite plays 60
  (First Blood) or 24 (Full Battle, ±10) games per pairing, and its element pair cycles through
  ember+tide, tide+grove, grove+storm, storm+stone, stone+frost and frost+ember, two games per pair
  so that each pair is played with both colour assignments. (Before this step the pair changed every
  game, which with an even number of elements tied each pair to one colour; the first six-element
  run showed a 60–62% white score that was that artefact, see 3.4.)
- **Element builds** are mono-element Focused builds (Headmaster Ring, Resonance Crystal, Scout's
  Lens), picked by `apps/tools/src/sim/builds.ts` from module data. With pool `any`:

  | Element | Abilities (all piece types)                              |
  | ------- | -------------------------------------------------------- |
  | Storm   | Squall, Afterimage, Pawn Storm, Slipstream, Last Word    |
  | Stone   | Stonewall, Rebuild, Buttress, Phalanx, Last Word         |
  | Frost   | Frost Heave, Permafrost, Snowdrift, Snowbound, Last Word |
  | Ember   | Backdraft, Riposte, Cleave, Momentum, Last Word          |
  | Tide    | Last Word, Hit and Run, Scout, Pierce, Squall            |
  | Grove   | Poisoned Meat, Rebirth, Reinforce, Antidote, Last Word   |

  Pool `affinity` drops the fifth, off-element card, so each element plays its four own cards.

- The Trainer knows the new effect patterns (`packages/ai` `profileOf` and `traitEffects`): it sees a
  captor pushed back or sent home, a friend protected, an enemy moved, Bulwark, Stillness and Always
  First, so it neither walks into Frost Heave blindly nor ignores Buttress.
- **Paired comparisons.** Seeds are handed out in job order, so two runs over the same element list
  play the same seeds, and a before/after difference comes from the change (plus the Trainer's
  reaction to it, which cascades within a game). A run over a different `--elements` list (new in
  this step) shifts the seeds: the same code then scores up to 12 points differently in a pairing
  (Storm against Ember: 26.7% in the six-element run, 37.5% in a five-element run). That is the
  sampling noise of these tables, and no conclusion below rests on a smaller difference.
- Raw results are written to `reports/sim/`; the command is shown under each table.

Caveat, as at Gate 1: the NPC is a shallow searcher with approximate ability knowledge below the root.
Human play will differ, especially in bluffing and probing. Treat these numbers as directional.

## 2. What was tuned

Nothing COMMITTED changed: the silence rule and `silenceScope` (`ALL_TRIGGERS`), the six traits and
identities (6.1), the formats and the item slots. The first triangle's kits were not touched: they are
the designer's question 2 from Gate 1. The twelve new cards' level requirements were set once by power
band (Storm 1–12, Stone 2–17, Frost 3–20) and not moved: every army here is level 25, so the
simulator cannot justify moving them.

| Change                                 | Before                                                                                                                                         | After                                                                                                                                              | Why                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stone's level-10 card (never released) | **Close Ranks** (Captures): after capturing, one of the owner's knights, bishops, rooks or queens next to the vacated square must step into it | **Phalanx** (Capturing): when a pawn captures, the victim's When-captured abilities are negated for that capture; attuned, knights and bishops too | The forced step-in pulled a defender off its post after every Stone capture: Stone scored 20% against Ember in Full Battle, with no silence between them. Phalanx protects the capture itself |
| Snowbound (Frost, level 14) charges    | unlimited                                                                                                                                      | 2                                                                                                                                                  | Uncharged, every Frost capture could first send the nearest defender home, so no Frost capture could be answered by that piece; a cap on the strongest repeatable control effect              |
| Permafrost (Frost, level 20) charges   | unlimited                                                                                                                                      | 1                                                                                                                                                  | The strongest push (captor sent to its start) on every Frost piece of a Headmaster Ring build; one use per piece, like Rebirth and Rebuild                                                    |

**Close Ranks to Phalanx** (paired: same six-element job list and seeds, pool `any`):

| Stone against     | First Blood, Close Ranks | First Blood, Phalanx | Full Battle, Close Ranks | Full Battle, Phalanx |
| ----------------- | ------------------------ | -------------------- | ------------------------ | -------------------- |
| Ember             | 41.7%                    | 45.8%                | 20.0%                    | 46.3%                |
| Tide              | 0.0%                     | 0.0%                 | 2.5%                     | 0.0%                 |
| Grove             | 48.3%                    | 59.2%                | 5.0%                     | 11.3%                |
| Storm (advantage) | 62.5%                    | 65.8%                | 93.8%                    | 87.5%                |
| Frost (foil)      | 40.0%                    | 30.0%                | 28.7%                    | 37.5%                |

A control run with Close Ranks removed (Ember, Storm, Stone and Frost only, 24 games) put Stone at
52.1% against Ember, which confirmed the card itself was the drag. The advantaged-element score moved
from 61.8% to 64.0% in First Blood and from 75.2% to 72.7% in Full Battle.

**Frost charges** (paired, pool `any`): **no measurable effect.** The First Blood table is identical
in every cell (the first non-pawn capture ends First Blood, so a limit of 1 or 2 almost never binds),
and in Full Battle the Frost cells moved within noise (Frost against Stone 62.5% to 65.0%, against
Storm 33.8% to 33.8%, mirror 45.0% to 46.3%; advantaged-element score 72.7% to 73.1%). The charges
are kept as a design bound on repeatable control, stated in the card text; reverting either is a
one-line change in its module.

## 3. Results against the 17.2 targets

### 3.1 Element advantage (target: advantaged element 55–60%)

Row element's score against the column element. Advantaged pairs: Tide over Ember, Ember over Grove,
Grove over Tide, Storm over Frost, Frost over Stone, Stone over Storm.

**First Blood, silence `ALL_TRIGGERS`, pool `any`** —
`pnpm sim --suite elements --format first_blood --games 60 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 23.3% | 18.3%               | 57.5%               | 73.3%               | 54.2%               | 31.7%               |
| tide          | 81.7%               | mirror, white 98.3% | 43.3%               | 96.7%               | 100.0%              | 78.3%               |
| grove         | 42.5%               | 56.7%               | mirror, white 40.0% | 35.0%               | 40.8%               | 25.8%               |
| storm         | 26.7%               | 3.3%                | 65.0%               | mirror, white 50.0% | 34.2%               | 52.5%               |
| stone         | 45.8%               | 0.0%                | 59.2%               | 65.8%               | mirror, white 50.0% | 30.0%               |
| frost         | 68.3%               | 21.7%               | 74.2%               | 47.5%               | 70.0%               | mirror, white 51.7% |

Advantaged element: **64.0%**. White: 50.0%. Surprise losses: 32.8%. Median 18 plies. With pool
`affinity` (`--pool affinity`): advantaged element 64.0%, white 49.7%, surprise losses 32.5%, median
18 plies.

**Full Battle, `ALL_TRIGGERS`, pool `any`** —
`pnpm sim --suite elements --format full --games 40 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 48.8% | 5.0%                | 28.7%               | 16.3%               | 53.8%               | 32.5%               |
| tide          | 95.0%               | mirror, white 98.8% | 3.8%                | 100.0%              | 100.0%              | 95.0%               |
| grove         | 71.3%               | 96.3%               | mirror, white 53.8% | 83.8%               | 88.8%               | 91.3%               |
| storm         | 83.8%               | 0.0%                | 16.3%               | mirror, white 61.3% | 12.5%               | 66.3%               |
| stone         | 46.3%               | 0.0%                | 11.3%               | 87.5%               | mirror, white 53.8% | 35.0%               |
| frost         | 67.5%               | 5.0%                | 8.8%                | 33.8%               | 65.0%               | mirror, white 46.3% |

Advantaged element: **73.1%**. White: 52.5%. Surprise losses: 0.5%. Median 69 plies.

**Full Battle, `ALL_TRIGGERS`, pool `affinity`** —
`pnpm sim --suite elements --format full --games 40 --pool affinity --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 43.8% | 2.5%                | 31.3%               | 37.5%               | 43.8%               | 37.5%               |
| tide          | 97.5%               | mirror, white 98.8% | 1.3%                | 100.0%              | 100.0%              | 77.5%               |
| grove         | 68.8%               | 98.8%               | mirror, white 40.0% | 68.8%               | 90.0%               | 100.0%              |
| storm         | 62.5%               | 0.0%                | 31.3%               | mirror, white 46.3% | 15.0%               | 73.8%               |
| stone         | 56.3%               | 0.0%                | 10.0%               | 85.0%               | mirror, white 47.5% | 30.0%               |
| frost         | 62.5%               | 22.5%               | 0.0%                | 26.3%               | 70.0%               | mirror, white 53.8% |

Advantaged element: **76.0%**. White: 51.0%. Surprise losses: 0.0%. Median 74 plies.

### 3.2 The two wheels side by side

| Advantaged pairing  | First Blood, any | First Blood, affinity | Full Battle, any | Full Battle, affinity |
| ------------------- | ---------------- | --------------------- | ---------------- | --------------------- |
| Storm over Frost    | 52.5%            | 56.7%                 | 66.3%            | 73.8%                 |
| Frost over Stone    | 70.0%            | 60.8%                 | 65.0%            | 70.0%                 |
| Stone over Storm    | 65.8%            | 70.8%                 | 87.5%            | 85.0%                 |
| **Second triangle** | **62.8%**        | **62.8%**             | **72.9%**        | **76.3%**             |
| Tide over Ember     | 81.7%            | 81.7%                 | 95.0%            | 97.5%                 |
| Ember over Grove    | 57.5%            | 57.5%                 | 28.7%            | 31.3%                 |
| Grove over Tide     | 56.7%            | 56.7%                 | 96.3%            | 98.8%                 |
| **First triangle**  | **65.3%**        | **65.3%**             | **73.3%**        | **75.9%**             |

**The silenceScope knob (6.2), Full Battle, pool `any`** (`--silence REACTIONS_ONLY`; `REACTIONS_ONLY`
spares the disadvantaged captor's Capturing abilities):

| silenceScope             | Storm over Frost | Frost over Stone | Stone over Storm | Tide over Ember | Ember over Grove | Grove over Tide | Advantaged element |
| ------------------------ | ---------------- | ---------------- | ---------------- | --------------- | ---------------- | --------------- | ------------------ |
| `ALL_TRIGGERS` (default) | 66.3%            | 65.0%            | 87.5%            | 95.0%           | 28.7%            | 96.3%           | 73.1%              |
| `REACTIONS_ONLY`         | 70.0%            | 35.0%            | 87.5%            | 95.0%           | 47.5%            | 92.5%           | 71.3%              |

Pairings whose builds carry no Capturing card (Storm against Stone, Tide against Ember) play the same
games under both scopes. Under `REACTIONS_ONLY` Stone beats its foil Frost (65%): Stone's protection
sits in Capturing cards (Buttress, Phalanx), which Frost no longer silences.

### 3.3 Across the triangles (no silence applies; target: near even)

The new element's score against each first-triangle element:

| New element  | First Blood: Ember | Tide     | Grove     | Full Battle: Ember | Tide     | Grove     |
| ------------ | ------------------ | -------- | --------- | ------------------ | -------- | --------- |
| Storm        | 26.7%              | 3.3%     | 65.0%     | 83.8%              | 0.0%     | 16.3%     |
| Stone        | 45.8%              | 0.0%     | 59.2%     | 46.3%              | 0.0%     | 11.3%     |
| Frost        | 68.3%              | 21.7%    | 74.2%     | 67.5%              | 5.0%     | 8.8%      |
| **Mean**     | **46.9%**          | **8.3%** | **66.1%** | **65.9%**          | **1.7%** | **12.1%** |
| Ember itself | —                  | 18.3%    | 57.5%     | —                  | 5.0%     | 28.7%     |

Against Ember, the reference element of the first triangle, the new elements are near even (47% in
First Blood, 66% in Full Battle). Tide beats them as it beats Ember, and Grove outlasts them in Full
Battle as it outlasts Ember even through the silence.

### 3.4 Builds (target: Maximum, Flexible and Focused each 45–55% against the others)

**First Blood** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 58.3%    | 59.2%   | 55.8%   |
| flexible      | 41.7%   | —        | 65.0%   | 66.7%   |
| focused       | 40.8%   | 35.0%    | —       | 39.2%   |
| starter       | 44.2%   | 33.3%    | 60.8%   | —       |

White: 49.3%. Surprise losses: 34.6%. Median 16 plies.

**Full Battle** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 56.3%    | 64.6%   | 79.2%   |
| flexible      | 43.8%   | —        | 54.2%   | 68.8%   |
| focused       | 35.4%   | 45.8%    | —       | 58.3%   |
| starter       | 20.8%   | 31.3%    | 41.7%   | —       |

White: 53.8%. Surprise losses: 0.9%. Median 75 plies.

**First Blood by triangle** (add `--elements ember,tide,grove` or `--elements storm,stone,frost`; row's
score):

| Pairing             | All six | First triangle only | Second triangle only |
| ------------------- | ------- | ------------------- | -------------------- |
| Maximum vs Flexible | 58.3%   | 60.0%               | 55.0%                |
| Maximum vs Focused  | 59.2%   | 53.3%               | 70.0%                |
| Flexible vs Focused | 65.0%   | 55.0%               | 60.8%                |
| Focused vs Starter  | 39.2%   | 41.7%               | 43.3%                |
| White               | 49.3%   | 48.9%               | 46.5%                |
| Surprise losses     | 34.6%   | 16.7%               | 54.8%                |

With the first triangle alone, Focused is inside the band (45–47%); with the new elements it trails
(30–39%). The first run of this suite, with the colour artefact of section 1, scored white at 60.0%
(First Blood) and 61.8% (Full Battle); the balanced runs above score 49.3% and 53.8%.

### 3.5 Other targets

| Metric                                          | Target    | Simulator                                                                                           | Verdict                                |
| ----------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- | -------------------------------------- |
| White win rate                                  | ≤ 56%     | 50.0% First Blood, 52.5% Full Battle (elements); builds 49–54%; Tide mirror 98%; new mirrors 46–61% | Met overall; missed in the Tide mirror |
| Surprise losses                                 | < 15%     | 32.8% First Blood (games with Stone 48%, Storm 39%, Frost 36%, Tide 4%), 0.5% Full Battle           | Missed in First Blood                  |
| Single ability pick rate in top ranked loadouts | < 40%     | needs live ranked data                                                                              | Not measurable yet                     |
| First Blood median length                       | 2–5 min   | 18 plies (about 9 moves each)                                                                       | Plausible at live move times           |
| Full Battle median length                       | 10–25 min | 69–74 plies                                                                                         | Plausible                              |

## 4. What the data says

1. **The second wheel works, with the same shape as the first.** Every advantaged new element wins in
   both formats and both pools. First Blood is close to the band (62.8% on average); Full Battle is
   well above it (73–76%), exactly like the first triangle (65% and 73–76%). Silencing every trigger
   of the weaker piece for a whole Full Battle decides most games, as Gate 1 found.
2. **Stone over Storm is the most one-sided (85–88% in Full Battle).** Storm's power is all triggered
   bonus moves: against Stone, Squall is silenced when a Storm piece is taken and Pawn Storm,
   Slipstream and Afterimage are silenced when it captures, while Stone keeps Bulwark, Buttress and
   Stonewall. In First Blood it is 66–71%.
3. **Storm over Frost is the closest (52.5% in First Blood).** Stillness is a trait, so silence never
   switches it off: a Storm piece that takes a Frost piece has its Captures abilities negated anyway.
   Storm's edge is Squall plus silencing all of Frost's triggers. This is 6.1 working as written.
4. **Frost is the strongest new element in First Blood** (68% against Ember, 74% against Grove, 70%
   against Stone); **Storm is the weakest there** (27% against Ember) but wins long games against
   Ember (84%): bonus moves pay off over many captures.
5. **Across the triangles, the new elements sit at Ember's level.** Tide wins every cross-triangle
   pairing (First Blood 78–100%, Full Battle 95–100%) and Grove wins them all in Full Battle
   (84–91%). Raising the new elements to Tide's and Grove's level would leave Ember alone at the
   bottom; bringing Tide and Grove down is Gate 1's question 2.
6. **`REACTIONS_ONLY` does not help** (71.3% against 73.1%) and inverts Frost over Stone, because
   Stone's protection is in Capturing cards. With this catalogue it is not a candidate.
7. **Surprise losses rise in First Blood** (33% in the element suite, 29% at Gate 1; 55% among
   new-element builds). The simulator counts a loss as a surprise when any ability of the winner that
   the loser had not seen triggers in the deciding action, whether or not it changed the result. Most
   of the new cards trigger on their owner's own captures (Buttress, Phalanx, Afterimage, Pawn Storm,
   Slipstream, Snowdrift, Snowbound), so the capture that ends a First Blood game often shows one for
   the first time. Some of that is the metric; the rest is real hidden power, and only one new card
   reveals anything (Stonewall's attuned version reveals the captor's type set). Gate 1's advice
   stands: add reveal tools before hidden power.
8. **Builds.** Maximum and Flexible are level (56–58%). Focused trails both: 35–41% in First Blood
   and 35–46% in Full Battle; in First Blood it is inside the band with the first triangle alone and
   30–39% with the new elements. White is fine once the suite plays each element pair with both
   colours (section 1).

## 5. Questions for the designer

Each has a ready-to-test option; none blocks the build.

1. **Silence strength (Gate 1 question 1, now with six elements).** Both triangles give 73–76% in Full
   Battle. `REACTIONS_ONLY` is ruled out (section 4.6), and so is Gate 1's option (a) (silence only the
   Captured abilities): both spare the weaker captor's Capturing cards, which is what lets Stone beat
   Frost. Gate 1's option (c), silence one ability per capture, is the untested candidate left.
2. **Tide and Grove kits (Gate 1 question 2).** They now dominate the new elements too, so this is the
   largest balance lever in the game. The Gate 1 candidates (Hit and Run's attuned landing limited to
   the origin, Pierce not on the first move) apply unchanged.
3. **Storm against Stone.** Accept 85–88% in Full Battle (the counterplay is keeping Storm pieces
   away from Stone ones), or give Storm one Passive card, which silence never touches (6.2), so a
   Storm army keeps some tempo against its foil. A content-only change.
4. **Frost charges.** Keep Snowbound at 2 charges and Permafrost at 1 (a design bound the simulator
   cannot measure), or return to unlimited use.
5. **Reveal tools for First Blood.** Surprise losses are 33–55% in First Blood, even though every
   simulated Focused build carries Scout's Lens (the first ability of the opponent's pawn set). Ready
   to test: a Lens that reveals the whole pawn set, or an attuned reveal on one card per new element
   (as on Stonewall). Counting only abilities that changed the outcome would also tell the metric's
   share from real hidden power (section 4.7).

## 6. The 15-minute checklist (local build)

Run `pnpm dev`, open the printed URL and sign in as `level25@local.test` (after `pnpm seed`).

| Minute | Try this                                                                                                     | Look for                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–2    | Thistle Meadow → west gate → Highcairn Pass; talk to Pathfinder Maud                                         | The warp works both ways; Maud explains Always First, Bulwark, Stillness and the second triangle                                             |
| 2–5    | Battle Stormcaller Imre (Storm)                                                                              | Squall's bonus pawn move and Afterimage's step after a capture; the log shows Storm abilities resolving first (Always First)                 |
| 5–8    | Battle Mason Hedda (Stone), then take a Stone piece with an effect                                           | Buttress protects a neighbour; the first effect capture against a Stone piece fizzles (Bulwark)                                              |
| 8–11   | Battle Rimeguard Osk (Frost)                                                                                 | Frost Heave pushes your captor back; Snowdrift moves one of your pieces; capturing a Frost piece negates your Captures abilities (Stillness) |
| 11–13  | Loadouts → a Storm army with Squall and Pawn Storm; a Stone army with Phalanx on pawns                       | Element pickers offer all six elements; the Attunement Charm lists them too                                                                  |
| 13–15  | Walk in the frost grass; in a battle, emulate grayscale and colour blindness (browser dev tools → Rendering) | Wild Sparklets, Pebblets and Frostlets appear only in the grass; the new creatures' emblems and rings read without colour                    |

After playing, answer the five questions in section 5 in `docs/DESIGN.md` section 18 (or tell the
agent).
