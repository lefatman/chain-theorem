# Balance baseline with the four-category build picker

The simulator's build picker was the last tooling gap named in `docs/BALANCE_DD98.md` section 4: it
capped every category at half the set, left passives out, and so played no Capturing card at all,
which made the `REACTIONS_ONLY` silence scope unmeasurable and kept Obstinate and Block Path out of
every table. This report fixes the picker (simulator tooling only, no design decision, R-TEST-002)
and re-measures the whole catalogue of 33 abilities against the 17.2 targets. It is the baseline
that the balance changes queued after it (silence scope, trait numbers, per-card changes, new cards)
are each measured against. Nothing COMMITTED was touched.

**Status.** @@STATUS@@

## 1. Method

Same as `docs/BALANCE_M7.md` section 1 and `docs/BALANCE_DD98.md`: `pnpm sim`, Trainer tier on both
sides, 20,000 nodes per move (deterministic), 60 games per element pairing in First Blood (about
±6.5 points of noise per cell) and 40 in Full Battle (±8), the archetype suite at 60 and 24 (±10),
colours alternating within a pairing, draws counting as half a win, every army level 25, pool `any`.
Raw results are in `reports/sim/` (not committed); the command is shown under each table.

Three things are new in `apps/tools/src/sim/builds.ts` and `cli.ts`:

1. **Dealing across categories.** The best card comes first (the element's signature), then the
   emptiest category is dealt its best remaining card each time, ties going to the category whose
   best card scores highest. A set of four or more slots therefore carries one Captured, one
   Captures, one Capturing and one Passive card; the fifth slot goes to the strongest remaining
   card. Capacity is still filled by slot cost (7.3).
2. **Passives are in.** Obstinate is the top neutral passive, so it is in every Focused build;
   Block Path, Veil and the Storm signature Electric Slide fill the king set behind Stalwart. Stalwart
   is placed only on the king set (from level 16): anywhere else loadout rule 8 (DD-102) would strip
   the set of its Capturing and Captures cards. Two cards that can never act on a king are not dealt
   to it: Captured cards (a king is never captured; a Stalwart king's capture ends the battle,
   R-RULES-004) and Obstinate (nothing outranks a king, DD-97).
3. **A per-type set prefers cards built for the type.** Pawn Storm goes to the pawn set and
   Afterimage to the knight, bishop, rook and queen sets of the Maximum and Flexible builds; an
   army-wide set (Focused, Starter) ranks a type-bound card below every army-wide card, because it
   idles on the other types but still uses the slot (7.3).

A fourth addition is a new suite, **`--suite cards`** (section 5): a mirror test per ability.

The builds the tables below were played with:

| Build | Set | Cards |
| --- | --- | --- |
| Focused (element suite) | all | Ember: Cleave, Last Word, Scout, Obstinate, Squall. Tide: Hit and Run, Last Word, Scout, Obstinate, Squall. Grove: Poisoned Meat, Snowdrift, Scout, Obstinate, Last Word. Storm: Electric Slide, Last Word, Snowdrift, Scout, Squall. Stone: Stonewall, Snowdrift, Scout, Obstinate, Last Word. Frost: Frost Heave, Snowdrift, Scout, Obstinate, Last Word |
| Starter | all | Signature plus Last Word (Ember, Tide, Storm) or Scout (Grove, Stone, Frost); level 5 pool |
| Maximum (ember + tide) | pawn | Cleave, Rebirth, Scout, Obstinate, Pawn Storm |
| | knight, bishop | Cleave, Rebirth, Scout, Obstinate, Afterimage |
| | rook, queen | Hit and Run, Rebirth, Scout, Obstinate, Afterimage |
| | king | Stalwart, Block Path, Veil, Electric Slide |
| Flexible (ember + tide) | pawn to queen | The Maximum set without its fifth card |
| | king | Stalwart, Block Path, Veil, Electric Slide |

The other element pairs of the archetype suite follow the same pattern with their own signatures
(Storm's signature is a passive, so its rook and queen sets take Rebirth, Afterimage, Scout and
Momentum around Electric Slide).

## 2. Element matchups

Row element's score against the column element. Advantaged pairs: Tide over Ember, Ember over Grove,
Grove over Tide, Storm over Frost, Frost over Stone, Stone over Storm.

**First Blood** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000`

| Row vs column | ember | tide | grove | storm | stone | frost |
| --- | --- | --- | --- | --- | --- | --- |
| ember | mirror, white 51.7% | 29.2% | 47.5% | 3.3% | 59.2% | 57.5% |
| tide | 70.8% | mirror, white 35.0% | 67.5% | 46.7% | 87.5% | 68.3% |
| grove | 52.5% | 32.5% | mirror, white 30.8% | 0.0% | 63.3% | 45.8% |
| storm | 96.7% | 53.3% | 100.0% | mirror, white 0.0% | 100.0% | 99.2% |
| stone | 40.8% | 12.5% | 36.7% | 0.0% | mirror, white 65.0% | 60.0% |
| frost | 42.5% | 31.7% | 54.2% | 0.8% | 40.0% | mirror, white 51.7% |

Advantaged element: **48.3%**. White 46.9%, surprise losses 6.5%, median 23 plies. Result reasons: repetition 74, objective 1120, checkmate 61, ply_cap 5.

**Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

| Row vs column | ember | tide | grove | storm | stone | frost |
| --- | --- | --- | --- | --- | --- | --- |
| ember | mirror, white 40.0% | 18.8% | 76.3% | 87.5% | 65.0% | 47.5% |
| tide | 81.3% | mirror, white 51.2% | 20.0% | 83.8% | 92.5% | 88.8% |
| grove | 23.8% | 80.0% | mirror, white 55.0% | 95.0% | 47.5% | 81.3% |
| storm | 12.5% | 16.3% | 5.0% | mirror, white 61.3% | 27.5% | 70.0% |
| stone | 35.0% | 7.5% | 52.5% | 72.5% | mirror, white 53.8% | 43.8% |
| frost | 52.5% | 11.3% | 18.8% | 30.0% | 56.3% | mirror, white 53.8% |

Advantaged element: **72.7%**. White 52.0%, surprise losses 0.0%, median 69 plies. Result reasons: checkmate 612, repetition 194, ply_cap 29, stalemate 2, fifty_move 3.

## 3. The `REACTIONS_ONLY` silence scope

6.2 says to test `REACTIONS_ONLY` first when the disadvantaged side loses too often; with every build
now carrying a Capturing card (Scout), the knob changes games. Same seeds as section 2, so each
cell is a paired comparison with the table above.

**First Blood** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000 --silence REACTIONS_ONLY`

| Row vs column | ember | tide | grove | storm | stone | frost |
| --- | --- | --- | --- | --- | --- | --- |
| ember | mirror, white 51.7% | 29.2% | 47.5% | 3.3% | 59.2% | 57.5% |
| tide | 70.8% | mirror, white 35.0% | 67.5% | 46.7% | 87.5% | 68.3% |
| grove | 52.5% | 32.5% | mirror, white 30.8% | 0.0% | 63.3% | 45.8% |
| storm | 96.7% | 53.3% | 100.0% | mirror, white 0.0% | 100.0% | 99.2% |
| stone | 40.8% | 12.5% | 36.7% | 0.0% | mirror, white 65.0% | 63.3% |
| frost | 42.5% | 31.7% | 54.2% | 0.8% | 36.7% | mirror, white 51.7% |

Advantaged element: **47.8%**. White 46.7%, surprise losses 6.5%, median 23 plies. Result reasons: repetition 74, objective 1119, checkmate 62, ply_cap 5.

**Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000 --silence REACTIONS_ONLY`

| Row vs column | ember | tide | grove | storm | stone | frost |
| --- | --- | --- | --- | --- | --- | --- |
| ember | mirror, white 40.0% | 17.5% | 78.8% | 87.5% | 65.0% | 47.5% |
| tide | 82.5% | mirror, white 51.2% | 25.0% | 83.8% | 92.5% | 88.8% |
| grove | 21.3% | 75.0% | mirror, white 55.0% | 95.0% | 47.5% | 81.3% |
| storm | 12.5% | 16.3% | 5.0% | mirror, white 61.3% | 27.5% | 70.0% |
| stone | 35.0% | 7.5% | 52.5% | 72.5% | mirror, white 53.8% | 46.3% |
| frost | 52.5% | 11.3% | 18.8% | 30.0% | 53.8% | mirror, white 53.8% |

Advantaged element: **72.1%**. White 51.8%, surprise losses 0.0%, median 69 plies. Result reasons: checkmate 611, repetition 194, ply_cap 30, fifty_move 4, stalemate 1.

## 4. Build archetypes

**First Blood** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| --- | --- | --- | --- | --- |
| maximum | — | 60.0% | 57.5% | 63.3% |
| flexible | 40.0% | — | 47.5% | 70.0% |
| focused | 42.5% | 52.5% | — | 70.0% |
| starter | 36.7% | 30.0% | 30.0% | — |

White 46.4%, surprise losses 34.9%, median 13 plies. Result reasons: objective 348, checkmate 8, stalwart_captured 2, repetition 2.

**Full Battle** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| --- | --- | --- | --- | --- |
| maximum | — | 43.8% | 79.2% | 100.0% |
| flexible | 56.3% | — | 85.4% | 95.8% |
| focused | 20.8% | 14.6% | — | 89.6% |
| starter | 0.0% | 4.2% | 10.4% | — |

White 50.3%, surprise losses 6.4%, median 66 plies. Result reasons: repetition 26, stalwart_captured 12, ply_cap 7, checkmate 97, fifty_move 2.

Under `REACTIONS_ONLY` (same commands with `--silence REACTIONS_ONLY`):

**First Blood**

| Row vs column | maximum | flexible | focused | starter |
| --- | --- | --- | --- | --- |
| maximum | — | 60.0% | 57.5% | 63.3% |
| flexible | 40.0% | — | 47.5% | 70.0% |
| focused | 42.5% | 52.5% | — | 70.0% |
| starter | 36.7% | 30.0% | 30.0% | — |

White 46.4%, surprise losses 34.9%, median 13 plies. Result reasons: objective 348, checkmate 8, stalwart_captured 2, repetition 2.

**Full Battle**

| Row vs column | maximum | flexible | focused | starter |
| --- | --- | --- | --- | --- |
| maximum | — | 43.8% | 79.2% | 100.0% |
| flexible | 56.3% | — | 85.4% | 95.8% |
| focused | 20.8% | 14.6% | — | 89.6% |
| starter | 0.0% | 4.2% | 10.4% | — |

White 50.3%, surprise losses 7.3%, median 66 plies. Result reasons: repetition 25, stalwart_captured 12, ply_cap 8, checkmate 97, fifty_move 2.

## 5. One card at a time: the mirror tests

`pnpm sim --suite cards` plays, for each ability, the element's Focused build with the card in front
of its four best other cards against those four cards alone. Both sides are the same element, so no
silence applies and both have the same trait: the score is the card's own worth at the Trainer's
level of play. A neutral card cycles through the six elements (both colours per element); a
signature plays on its own element, where it is Attuned. A card above 60% wins games by itself; the
17.2 proxy is that no ability's pick rate in top loadouts exceeds 40%. Cards that the tested card
excludes are left out of both sides (Stalwart: Capturing and Captures, rule 8).

**First Blood** — `pnpm sim --suite cards --format first_blood --games 36 --nodes 20000`

| Card | Category | Level | Score with the card | Games | Median plies | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Electric Slide | PASSIVE | 3 | 100.0% | 36 | 8 | **above 60%** |
| Obstinate | PASSIVE | 9 | 88.9% | 36 | 16 | **above 60%** |
| Squall | CAPTURED | 1 | 69.4% | 36 | 24 | **above 60%** |
| Stalwart | PASSIVE | 16 | 69.4% | 36 | 8 | **above 60%** |
| Slipstream | CAPTURES | 12 | 68.1% | 36 | 21 | **above 60%** |
| Afterimage | CAPTURES | 5 | 66.7% | 36 | 22 | **above 60%** |
| Pawn Storm | CAPTURES | 7 | 66.7% | 36 | 21 | **above 60%** |
| Schrödinger's Joker | CAPTURES | 20 | 66.7% | 36 | 27 | **above 60%** |
| Necromancer | CAPTURES | 11 | 65.3% | 36 | 24 | **above 60%** |
| Phalanx | CAPTURING | 10 | 62.5% | 36 | 32 | **above 60%** |
| Redo | CAPTURED | 15 | 61.1% | 36 | 24 | **above 60%** |
| Riposte | CAPTURED | 12 | 58.3% | 36 | 21 |  |
| Last Word | CAPTURED | 1 | 56.9% | 36 | 20 |  |
| Rebuild | CAPTURES | 17 | 56.9% | 36 | 25 |  |
| Buttress | CAPTURING | 2 | 55.6% | 36 | 25 |  |
| Reinforce | CAPTURES | 10 | 55.6% | 36 | 21 |  |
| Snowdrift | CAPTURES | 9 | 55.6% | 36 | 26 |  |
| Pierce | CAPTURING | 3 | 54.2% | 36 | 37 |  |
| Momentum | CAPTURES | 8 | 52.8% | 36 | 28 |  |
| Quantum Kill | CAPTURES | 13 | 52.8% | 36 | 24 |  |
| Poisoned Meat | CAPTURED | 2 | 51.4% | 36 | 30 |  |
| Veil | PASSIVE | 18 | 51.4% | 36 | 27 |  |
| Antidote | CAPTURING | 5 | 50.0% | 36 | 29 |  |
| Block Path | PASSIVE | 12 | 50.0% | 36 | 19 |  |
| Cleave | CAPTURES | 3 | 50.0% | 36 | 30 |  |
| Stonewall | CAPTURED | 3 | 50.0% | 36 | 33 |  |
| Hit and Run | CAPTURES | 1 | 47.2% | 36 | 26 |  |
| Scout | CAPTURING | 1 | 45.8% | 36 | 34 |  |
| Snowbound | CAPTURING | 14 | 45.8% | 36 | 19 |  |
| Permafrost | CAPTURED | 20 | 44.4% | 36 | 19 |  |
| Rebirth | CAPTURED | 14 | 44.4% | 36 | 27 |  |
| Backdraft | CAPTURED | 4 | 41.7% | 36 | 24 |  |
| Frost Heave | CAPTURED | 3 | 41.7% | 36 | 23 |  |

**Full Battle** — `pnpm sim --suite cards --format full --games 24 --nodes 20000`

@@CARDS_FULL@@

## 6. What the data says

@@FINDINGS@@
