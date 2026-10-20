# Balance baseline with the four-category build picker

The simulator's build picker was the last tooling gap named in `docs/BALANCE_DD98.md` section 4: it
capped every category at half the set, left passives out, and so played no Capturing card at all,
which made the `REACTIONS_ONLY` silence scope unmeasurable and kept Obstinate and Block Path out of
every table. This report fixes the picker (simulator tooling only, no design decision, R-TEST-002)
and re-measures the whole catalogue of 33 abilities against the 17.2 targets. It is the baseline
that the balance changes queued after it (silence scope, trait numbers, per-card changes, new cards)
are each measured against. Nothing COMMITTED was touched.

**Status.** The picker fix did what it was meant to: every build carries a Capturing card and a
passive, the `REACTIONS_ONLY` knob runs, and the two new passives are in the tables. What the tables
show is bigger than the tooling. The attuned Electric Slide turn gives Storm a forced First Blood
win from the opening (97–100% against four elements, 100% in its own mirror test with a median of 8
plies); army-wide Obstinate is the strongest card in both formats after it (89% and 96% on its own)
and decides Full Battle for whoever carries it, which Storm cannot; and the Stalwart king set decides
Full Battle between archetypes (Maximum and Flexible beat Focused 79–85%). Advantaged element 48% in
First Blood and 73% in Full Battle against a 55–60% target, White 47% and 52%, surprise losses 6.5%
and 0% with the corrected metric (35% in the First Blood archetype suite), medians 23 and 69 plies.
Section 6 lists the findings and what each later item of the plan takes from them. Section 7
re-measures after the Electric Slide fix (DD-106): the opening trap is gone (Storm's First Blood row
22–56%), the card alone reads 72% and 75%, and Storm is now the weakest Full Battle element for want
of Obstinate. Section 8 measures the silence scopes with a Capturing card in play (B3, DD-108): the new
`ONCE_PER_ABILITY` comes closest to the Full Battle target (61.7%) as long as Resonance Crystal does
not mean never under it. Section 9 carries out two designer answers (B3b, DD-109, DD-110): Stalwart
on a king costs an item slot, which prices the king set without yet making Focused competitive
against a paid Stalwart king (81–88% in Full Battle, as before), and Electric Slide ships its most
balanced measured turn (bishops only, at a bishop, rook, queen or king: 58% and 64% on its own). Section 10 records the designer's rulings on both (rule 9 reverted; Electric Slide turns by
rank, DD-111: 82.5% and 62.3% on its own) and the four trait numbers of B4 as config knobs, each
measured alone: Flow's one-ally cap does not tame Tide (aggregate 52.1% to 50.6% in First Blood,
69.2% to 72.2% in Full Battle), Bulwark's pawn exclusion and Hot Foot's fourth turn are inert at 40
and 30 games, and Overabundance's extra charge changes no game because no Focused build carries a
consumable; at the shipped defaults the advantaged element reads 48.3% and 73.5%. Section 11 measures B5's per-card changes and loadout rule 9: Obstinate at two slots still reads 79% and 73% on its own and the defaults 51.2% and 72.5%; Storm with Obstinate turns First Blood on its head (63–85% row) and brings the Full Battle aggregate to 64.0%; `ONCE_PER_ABILITY` with the shipped Crystal reads 57.9% and 62.5%, the closest any scope has come in both formats; and rule 9 brings Flexible against Focused (52.1%) and Maximum against Flexible (47.9%) into the band in Full Battle while Maximum over Focused keeps 72.9%. Scout's Lens now reveals a one-set army whole, so surprise losses read 0% in the element suites by construction. Section 12 measures C6's three neutral cards alone: Overwhelm 63.9% and 64.6% (the one above the line), Cornered 50.0% and 56.3%, Ricochet 50.0% and 39.6%, the last a card the NPC does not plan for. Section 13 measures C7's three items: Reliquary 61.1% and 64.6% (above the line); Duelist's Gauntlet 54.2% and 47.9% in the mirror and nothing in First Blood on the default builds (the Crystal spares the one exchange), 65.2% against 67.5% in Full Battle, 60.3% against 71.9% with Pierce preferred and 48.5% against 50.4% in First Blood without the Crystal; Herald's Horn 54.2% and 41.7% (information a mirror already has); without Scout's Lens, surprise losses return in First Blood (32.4% and 23.8%). Section 14 is the final report (B8): the finished catalogue at the shipped defaults reproduces section 11 (51.2% and 72.5%); `ONCE_PER_ABILITY` reads 54.8% and 61.4% against 55.4% and 72.8% on the same seeds; two of the three archetype pairs are in band in Full Battle; three cards (Obstinate, Stonewall, Squall) clear the 60% line in both formats and Reliquary is the one item that does in Full Battle; and twelve decisions go to the designer with a recommendation each.

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

| Build                   | Set            | Cards                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused (element suite) | all            | Ember: Cleave, Last Word, Scout, Obstinate, Squall. Tide: Hit and Run, Last Word, Scout, Obstinate, Squall. Grove: Poisoned Meat, Snowdrift, Scout, Obstinate, Last Word. Storm: Electric Slide, Last Word, Snowdrift, Scout, Squall. Stone: Stonewall, Snowdrift, Scout, Obstinate, Last Word. Frost: Frost Heave, Snowdrift, Scout, Obstinate, Last Word |
| Starter                 | all            | Signature plus Last Word (Ember, Tide, Storm) or Scout (Grove, Stone, Frost); level 5 pool                                                                                                                                                                                                                                                                 |
| Maximum (ember + tide)  | pawn           | Cleave, Rebirth, Scout, Obstinate, Pawn Storm                                                                                                                                                                                                                                                                                                              |
|                         | knight, bishop | Cleave, Rebirth, Scout, Obstinate, Afterimage                                                                                                                                                                                                                                                                                                              |
|                         | rook, queen    | Hit and Run, Rebirth, Scout, Obstinate, Afterimage                                                                                                                                                                                                                                                                                                         |
|                         | king           | Stalwart, Block Path, Veil, Electric Slide                                                                                                                                                                                                                                                                                                                 |
| Flexible (ember + tide) | pawn to queen  | The Maximum set without its fifth card                                                                                                                                                                                                                                                                                                                     |
|                         | king           | Stalwart, Block Path, Veil, Electric Slide                                                                                                                                                                                                                                                                                                                 |

The other element pairs of the archetype suite follow the same pattern with their own signatures
(Storm's signature is a passive, so its rook and queen sets take Rebirth, Afterimage, Scout and
Momentum around Electric Slide).

## 2. Element matchups

Row element's score against the column element. Advantaged pairs: Tide over Ember, Ember over Grove,
Grove over Tide, Storm over Frost, Frost over Stone, Stone over Storm.

**First Blood** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm              | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------ | ------------------- | ------------------- |
| ember         | mirror, white 51.7% | 29.2%               | 47.5%               | 3.3%               | 59.2%               | 57.5%               |
| tide          | 70.8%               | mirror, white 35.0% | 67.5%               | 46.7%              | 87.5%               | 68.3%               |
| grove         | 52.5%               | 32.5%               | mirror, white 30.8% | 0.0%               | 63.3%               | 45.8%               |
| storm         | 96.7%               | 53.3%               | 100.0%              | mirror, white 0.0% | 100.0%              | 99.2%               |
| stone         | 40.8%               | 12.5%               | 36.7%               | 0.0%               | mirror, white 65.0% | 60.0%               |
| frost         | 42.5%               | 31.7%               | 54.2%               | 0.8%               | 40.0%               | mirror, white 51.7% |

Advantaged element: **48.3%**. White 46.9%, surprise losses 6.5%, median 23 plies. Result reasons: repetition 74, objective 1120, checkmate 61, ply_cap 5.

**Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 40.0% | 18.8%               | 76.3%               | 87.5%               | 65.0%               | 47.5%               |
| tide          | 81.3%               | mirror, white 51.2% | 20.0%               | 83.8%               | 92.5%               | 88.8%               |
| grove         | 23.8%               | 80.0%               | mirror, white 55.0% | 95.0%               | 47.5%               | 81.3%               |
| storm         | 12.5%               | 16.3%               | 5.0%                | mirror, white 61.3% | 27.5%               | 70.0%               |
| stone         | 35.0%               | 7.5%                | 52.5%               | 72.5%               | mirror, white 53.8% | 43.8%               |
| frost         | 52.5%               | 11.3%               | 18.8%               | 30.0%               | 56.3%               | mirror, white 53.8% |

Advantaged element: **72.7%**. White 52.0%, surprise losses 0.0%, median 69 plies. Result reasons: checkmate 612, repetition 194, ply_cap 29, stalemate 2, fifty_move 3.

## 3. The `REACTIONS_ONLY` silence scope

6.2 says to test `REACTIONS_ONLY` first when the disadvantaged side loses too often; with every build
now carrying a Capturing card (Scout), the knob changes games. Same seeds as section 2, so each
cell is a paired comparison with the table above.

**First Blood** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000 --silence REACTIONS_ONLY`

| Row vs column | ember               | tide                | grove               | storm              | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------ | ------------------- | ------------------- |
| ember         | mirror, white 51.7% | 29.2%               | 47.5%               | 3.3%               | 59.2%               | 57.5%               |
| tide          | 70.8%               | mirror, white 35.0% | 67.5%               | 46.7%              | 87.5%               | 68.3%               |
| grove         | 52.5%               | 32.5%               | mirror, white 30.8% | 0.0%               | 63.3%               | 45.8%               |
| storm         | 96.7%               | 53.3%               | 100.0%              | mirror, white 0.0% | 100.0%              | 99.2%               |
| stone         | 40.8%               | 12.5%               | 36.7%               | 0.0%               | mirror, white 65.0% | 63.3%               |
| frost         | 42.5%               | 31.7%               | 54.2%               | 0.8%               | 36.7%               | mirror, white 51.7% |

Advantaged element: **47.8%**. White 46.7%, surprise losses 6.5%, median 23 plies. Result reasons: repetition 74, objective 1119, checkmate 62, ply_cap 5.

**Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000 --silence REACTIONS_ONLY`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 40.0% | 17.5%               | 78.8%               | 87.5%               | 65.0%               | 47.5%               |
| tide          | 82.5%               | mirror, white 51.2% | 25.0%               | 83.8%               | 92.5%               | 88.8%               |
| grove         | 21.3%               | 75.0%               | mirror, white 55.0% | 95.0%               | 47.5%               | 81.3%               |
| storm         | 12.5%               | 16.3%               | 5.0%                | mirror, white 61.3% | 27.5%               | 70.0%               |
| stone         | 35.0%               | 7.5%                | 52.5%               | 72.5%               | mirror, white 53.8% | 46.3%               |
| frost         | 52.5%               | 11.3%               | 18.8%               | 30.0%               | 53.8%               | mirror, white 53.8% |

Advantaged element: **72.1%**. White 51.8%, surprise losses 0.0%, median 69 plies. Result reasons: checkmate 611, repetition 194, ply_cap 30, fifty_move 4, stalemate 1.

## 4. Build archetypes

**First Blood** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 60.0%    | 57.5%   | 63.3%   |
| flexible      | 40.0%   | —        | 47.5%   | 70.0%   |
| focused       | 42.5%   | 52.5%    | —       | 70.0%   |
| starter       | 36.7%   | 30.0%    | 30.0%   | —       |

White 46.4%, surprise losses 34.9%, median 13 plies. Result reasons: objective 348, checkmate 8, stalwart_captured 2, repetition 2.

**Full Battle** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 43.8%    | 79.2%   | 100.0%  |
| flexible      | 56.3%   | —        | 85.4%   | 95.8%   |
| focused       | 20.8%   | 14.6%    | —       | 89.6%   |
| starter       | 0.0%    | 4.2%     | 10.4%   | —       |

White 50.3%, surprise losses 6.4%, median 66 plies. Result reasons: repetition 26, stalwart_captured 12, ply_cap 7, checkmate 97, fifty_move 2.

Under `REACTIONS_ONLY` (same commands with `--silence REACTIONS_ONLY`):

**First Blood**

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 60.0%    | 57.5%   | 63.3%   |
| flexible      | 40.0%   | —        | 47.5%   | 70.0%   |
| focused       | 42.5%   | 52.5%    | —       | 70.0%   |
| starter       | 36.7%   | 30.0%    | 30.0%   | —       |

White 46.4%, surprise losses 34.9%, median 13 plies. Result reasons: objective 348, checkmate 8, stalwart_captured 2, repetition 2.

**Full Battle**

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 43.8%    | 79.2%   | 100.0%  |
| flexible      | 56.3%   | —        | 85.4%   | 95.8%   |
| focused       | 20.8%   | 14.6%    | —       | 89.6%   |
| starter       | 0.0%    | 4.2%     | 10.4%   | —       |

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

| Card                | Category  | Level | Score with the card | Games | Median plies | Note          |
| ------------------- | --------- | ----- | ------------------- | ----- | ------------ | ------------- |
| Electric Slide      | PASSIVE   | 3     | 100.0%              | 36    | 8            | **above 60%** |
| Obstinate           | PASSIVE   | 9     | 88.9%               | 36    | 16           | **above 60%** |
| Squall              | CAPTURED  | 1     | 69.4%               | 36    | 24           | **above 60%** |
| Stalwart            | PASSIVE   | 16    | 69.4%               | 36    | 8            | **above 60%** |
| Slipstream          | CAPTURES  | 12    | 68.1%               | 36    | 21           | **above 60%** |
| Afterimage          | CAPTURES  | 5     | 66.7%               | 36    | 22           | **above 60%** |
| Pawn Storm          | CAPTURES  | 7     | 66.7%               | 36    | 21           | **above 60%** |
| Schrödinger's Joker | CAPTURES  | 20    | 66.7%               | 36    | 27           | **above 60%** |
| Necromancer         | CAPTURES  | 11    | 65.3%               | 36    | 24           | **above 60%** |
| Phalanx             | CAPTURING | 10    | 62.5%               | 36    | 32           | **above 60%** |
| Redo                | CAPTURED  | 15    | 61.1%               | 36    | 24           | **above 60%** |
| Riposte             | CAPTURED  | 12    | 58.3%               | 36    | 21           |               |
| Last Word           | CAPTURED  | 1     | 56.9%               | 36    | 20           |               |
| Rebuild             | CAPTURES  | 17    | 56.9%               | 36    | 25           |               |
| Buttress            | CAPTURING | 2     | 55.6%               | 36    | 25           |               |
| Reinforce           | CAPTURES  | 10    | 55.6%               | 36    | 21           |               |
| Snowdrift           | CAPTURES  | 9     | 55.6%               | 36    | 26           |               |
| Pierce              | CAPTURING | 3     | 54.2%               | 36    | 37           |               |
| Momentum            | CAPTURES  | 8     | 52.8%               | 36    | 28           |               |
| Quantum Kill        | CAPTURES  | 13    | 52.8%               | 36    | 24           |               |
| Poisoned Meat       | CAPTURED  | 2     | 51.4%               | 36    | 30           |               |
| Veil                | PASSIVE   | 18    | 51.4%               | 36    | 27           |               |
| Antidote            | CAPTURING | 5     | 50.0%               | 36    | 29           |               |
| Block Path          | PASSIVE   | 12    | 50.0%               | 36    | 19           |               |
| Cleave              | CAPTURES  | 3     | 50.0%               | 36    | 30           |               |
| Stonewall           | CAPTURED  | 3     | 50.0%               | 36    | 33           |               |
| Hit and Run         | CAPTURES  | 1     | 47.2%               | 36    | 26           |               |
| Scout               | CAPTURING | 1     | 45.8%               | 36    | 34           |               |
| Snowbound           | CAPTURING | 14    | 45.8%               | 36    | 19           |               |
| Permafrost          | CAPTURED  | 20    | 44.4%               | 36    | 19           |               |
| Rebirth             | CAPTURED  | 14    | 44.4%               | 36    | 27           |               |
| Backdraft           | CAPTURED  | 4     | 41.7%               | 36    | 24           |               |
| Frost Heave         | CAPTURED  | 3     | 41.7%               | 36    | 23           |               |

**Full Battle** — `pnpm sim --suite cards --format full --games 24 --nodes 20000`

| Card                | Category  | Level | Score with the card | Games | Median plies | Note                    |
| ------------------- | --------- | ----- | ------------------- | ----- | ------------ | ----------------------- |
| Electric Slide      | PASSIVE   | 3     | 100.0%              | 24    | 37           | **above 60%**           |
| Obstinate           | PASSIVE   | 9     | 95.8%               | 24    | 57           | **above 60%**           |
| Stalwart            | PASSIVE   | 16    | 81.3%               | 24    | 45           | **above 60%**           |
| Poisoned Meat       | CAPTURED  | 2     | 77.1%               | 24    | 80           | **above 60%**           |
| Block Path          | PASSIVE   | 12    | 72.9%               | 24    | 88           | **above 60%**           |
| Rebirth             | CAPTURED  | 14    | 72.9%               | 24    | 83           | **above 60%**           |
| Riposte             | CAPTURED  | 12    | 70.8%               | 24    | 81           | **above 60%**           |
| Snowdrift           | CAPTURES  | 9     | 66.7%               | 24    | 85           | **above 60%**           |
| Squall              | CAPTURED  | 1     | 66.7%               | 24    | 80           | **above 60%**           |
| Buttress            | CAPTURING | 2     | 64.6%               | 24    | 65           | **above 60%**           |
| Afterimage          | CAPTURES  | 5     | 62.5%               | 24    | 83           | **above 60%**           |
| Antidote            | CAPTURING | 5     | 62.5%               | 24    | 93           | **above 60%**           |
| Necromancer         | CAPTURES  | 11    | 62.5%               | 24    | 107          | **above 60%**           |
| Cleave              | CAPTURES  | 3     | 58.3%               | 24    | 50           |                         |
| Hit and Run         | CAPTURES  | 1     | 58.3%               | 24    | 61           |                         |
| Backdraft           | CAPTURED  | 4     | 56.3%               | 24    | 78           |                         |
| Scout               | CAPTURING | 1     | 56.3%               | 24    | 72           |                         |
| Slipstream          | CAPTURES  | 12    | 56.3%               | 24    | 98           |                         |
| Stonewall           | CAPTURED  | 3     | 56.3%               | 24    | 89           |                         |
| Phalanx             | CAPTURING | 10    | 54.2%               | 24    | 58           |                         |
| Frost Heave         | CAPTURED  | 3     | 52.1%               | 24    | 107          |                         |
| Permafrost          | CAPTURED  | 20    | 50.0%               | 24    | 96           |                         |
| Quantum Kill        | CAPTURES  | 13    | 50.0%               | 24    | 79           |                         |
| Rebuild             | CAPTURES  | 17    | 50.0%               | 24    | 81           |                         |
| Pierce              | CAPTURING | 3     | 47.9%               | 24    | 67           |                         |
| Last Word           | CAPTURED  | 1     | 41.7%               | 24    | 62           |                         |
| Pawn Storm          | CAPTURES  | 7     | 41.7%               | 24    | 83           |                         |
| Veil                | PASSIVE   | 18    | 41.7%               | 24    | 76           |                         |
| Schrödinger's Joker | CAPTURES  | 20    | 39.6%               | 24    | 97           | below 40% (a liability) |
| Momentum            | CAPTURES  | 8     | 37.5%               | 24    | 84           | below 40% (a liability) |
| Redo                | CAPTURED  | 15    | 37.5%               | 24    | 103          | below 40% (a liability) |
| Snowbound           | CAPTURING | 14    | 35.4%               | 24    | 77           | below 40% (a liability) |
| Reinforce           | CAPTURES  | 10    | 29.2%               | 24    | 74           | below 40% (a liability) |

## 6. What the data says

1. **Electric Slide decides First Blood from the opening.** The attuned turn (DD-104) lets a slider
   continue from an ally's square in a new direction, and at the start every ally a bishop or queen
   meets is a pawn on the second rank: the c1 bishop turns at b2 and takes g7 on move 1, the queen
   reaches e7, c7, f7, h7, a7, b7 and d7 through the king and its own pawns, and after any knight
   development (…Nf6, …Nc6) a bishop takes the knight on move 2 (`Bc1-b2-f6`, `Bf1-g2-c6`), which is
   the First Blood objective. Checked against a plain army with the engine: of Black's 40 legal
   replies to 1.a3, only the 12 pawn moves on the a, c, d, e, f and h files do not lose a piece at
   once. Snowdrift completes the opening trap by shoving the one recapturing bishop away. The Storm
   row reads 97–100% against every element but Tide (whose Flow keeps its knights behind the pawn
   wall and still 53%), and the Storm mirror is 0% for White: the first mover plays the forcing line,
   and the second mover answers with a hidden turn of its own. Electric Slide is PLAYTEST (designer
   brief 2026-10-06). Two fixes keep the card's identity: **(a) a slider turns only at an allied
   piece, never at a pawn** (recommended: the bishops' only diagonal neighbours at the start are
   pawns and the queen's rank neighbours lead into blocked files, so there is no opening shot, while
   mid-game turns at knights, bishops, rooks and the king stay), or (b) a slider turns only at an
   ally that has left its starting square (weaker: one pawn push restores the trap a move later).
   Done as DD-106 at the designer's request (plan item B2b), with the queen also left out after
   the pieces-only rule alone measured 97%: section 7 has the variants and the re-measurement.
2. **Obstinate is the backbone of every Full Battle build, and Storm has none.** The picker gives
   every Focused build its top passive, Obstinate, on all pieces, except Storm, whose signature is
   itself a passive and takes the slot. In Full Battle a queen may then capture nothing but queens
   and rooks nothing below a rook, and Storm, without that shield, loses 136 of its 200 non-mirror
   games by checkmate (score 26%, 5–28% against four elements) while it won 97–100% of the same
   pairings in First Blood. The same card reads the other way in the two formats: the format, not
   the element, decides whether Storm is broken or hopeless. The cards table (section 5) prices
   Obstinate on its own.
3. **The Stalwart king decides Full Battle between archetypes.** Maximum and Flexible carry a king
   set of Stalwart, Block Path and Veil (plus Electric Slide): a king that cannot be checkmated, is
   not in check from one direction and whose abilities act unnamed. They beat Focused 79% and 85%
   and Starter 96–100%, and the only way they lose is a move capture of the king
   (`stalwart_captured` 12 of 144). Focused's extra slot and army-wide cards cannot answer a king
   that has to be caught rather than mated. Between Maximum and Flexible (both Stalwart) the Full
   Battle score is 44–56%, inside the target, and in First Blood the three are at 58–63% / 40–53%:
   the archetype target is missed only through the king set. Rule 9 (B5, at most two Passives per
   set) would cut this king set to two cards; whether Stalwart should still cost one slot is a
   designer question.
4. **Element advantage.** First Blood 48% (DD-98: 46%), Full Battle 73% (DD-98: 90%). The Full Battle
   figure fell because the matchup is now decided more by who carries Obstinate and by Storm's
   collapse than by the silence rule. In Full Battle all six foil pairs point the right way; in
   First Blood only two do (Tide over Ember, Storm over Frost): the traits and the Electric Slide
   opening override the wheel there (Stone over Storm reads 0%). The 55–60% target is missed in
   both directions. Short games remain trait and opening games (median 23 plies), long games
   silence and shield games (median 69).
5. **`REACTIONS_ONLY` changes nothing with these builds.** The Capturing card the picker deals every
   Focused build is Scout, which only reveals a set, so sparing Capturing abilities from silence
   moves one pairing by two games in First Blood (Stone–Frost) and the advantaged score by 0.6 points
   in Full Battle (72.1% against 72.7%, five cells moving by one or two games). The
   knob can only be judged with Pierce, Phalanx, Buttress or Antidote in the builds; B3 (the silence
   scope item) should add a `--prefer` list to the simulator and run the pair again with Pierce.
6. **Surprise losses.** The old metric counted any unseen ability that triggered in the final action,
   and with Scout in every build it read 61% in First Blood. Counting only abilities that acted (an
   effect capture, a moved, revived or spawned piece, a rewind, an observed passive) it reads 6.5%
   in First Blood and 0% in Full Battle for the element suite, and 35% / 6% for the archetype suite,
   where the per-type builds carry Rebirth, Pawn Storm, Afterimage and Momentum and First Blood is
   decided in 13 plies. The target (< 15%) is met in Full Battle and by mono-element builds, missed
   by varied builds in the short format. Grove (Poisoned Meat), Stone (Stonewall) and Frost (Frost
   Heave) account for 72 of the 77 surprise wins in the element suite: the signatures that react.
7. **Cards on their own (section 5).** Two passives win First Blood by themselves: Electric Slide
   (100%, median 8 plies: the opening trap of finding 1, here on Storm pieces only) and Obstinate
   (89%: with every piece immune to higher-rank captures, the side without it may attack only with
   pawns, knights and bishops and loses the first exchange). Behind them a band at 61–69% (Squall,
   Stalwart, Slipstream, Afterimage, Pawn Storm, Schrödinger's Joker, Necromancer, Phalanx, Redo)
   where the ±8 points of noise of 36 games keeps any one card from being called broken; the
   reaction cards that need a particular capture to happen first (Backdraft, Frost Heave, Rebirth,
   Permafrost) read 42–44% in the short format because the first capture usually ends it before
   they fire, and the slot is lost. In Full Battle the same two lead (100%, 96%) with Stalwart third (81%: an
   army that effect captures cannot touch and that ignores Obstinate), then a band at 63–77%
   (Poisoned Meat, Block Path, Rebirth, Riposte, Snowdrift, Squall, Buttress, Afterimage, Antidote,
   Necromancer) inside the ±10 points of noise of 24 games. Five cards read below 40% (Reinforce
   29%, Snowbound 35%, Redo and Momentum 38%, Schrödinger's Joker 40%): the Trainer plays worse with
   them than without, which says as much about the NPC's model of them (its capture biases for
   revives, bonus moves and spawns, `packages/ai/src/fast.ts`) as about the cards, and is worth a
   look there before any of them is retuned. The 17.2 pick-rate proxy cannot be
   measured in a simulator; the mirror score stands in for it, and at the 60% bar it flags the two
   passives and no reaction card.

**What the plan's later items take from this.**

- A2 (alpha mode) is independent of these numbers.
- B2b (done, DD-106, section 7): Electric Slide turns only at an allied piece, never at a pawn,
  and only rooks and bishops turn; the element and archetype tables were re-run, since every later
  First Blood measurement was otherwise a measurement of the opening trap.
- B3 (silence scope): add a `--prefer` list to the simulator so the Focused builds carry Pierce or
  Phalanx, re-run the `REACTIONS_ONLY` pair, then measure `ONCE_PER_ABILITY` (finding 5).
- B4 (trait numbers): measure after B2b; the First Blood trait picture of DD-98 (Flow and Bulwark
  ahead) is not visible under the trap.
- B5 (per-card changes): the data backs Obstinate at 2 slots and rule 9 (at most two Passives per
  set), which also cuts the Stalwart king set to two cards (findings 2 and 3); whether Stalwart on a
  king should cost one slot is for the designer.
- C6, C7: every new card gets a `--suite cards` row in both formats before its matchup run.
- The NPC's capture biases for Reinforce, Snowbound, Redo, Momentum and the Joker (finding 7) are a
  `packages/ai` follow-up, not a balance change.

## 7. After the Electric Slide fix (DD-106)

Plan item B2b: a slider turns only at an allied piece other than a pawn (DD-106). Same method and
seeds as sections 2, 4 and 5, so every cell pairs with the one above it.

**Electric Slide alone** — `pnpm sim --suite cards --format first_blood --games 36 --nodes 20000 --cards electric_slide` and the same with `--format full --games 24`

| Format      | Card           | Category | Level | Score with the card | Games | Median plies | Note          |
| ----------- | -------------- | -------- | ----- | ------------------- | ----- | ------------ | ------------- |
| First Blood | Electric Slide | PASSIVE  | 3     | 72.2%               | 36    | 13           | **above 60%** |
| Full Battle | Electric Slide | PASSIVE  | 3     | 75.0%               | 24    | 76           | **above 60%** |

The three variants measured on the way to DD-106, same seeds (the first row is the shipped rule):

| Corner and turn rule                                               | First Blood (36) | Median plies | Full Battle (24) |
| ------------------------------------------------------------------ | ---------------- | ------------ | ---------------- |
| Pieces only; rooks and bishops turn once, the queen never (DD-106) | 72.2%            | 13           | 75.0%            |
| Pieces only; every slider turns once                               | 86.1%            | 8            | 66.7%            |
| Pieces only; rooks and bishops once, the queen twice               | 97.2%            | 8            | 66.7%            |
| Any ally including pawns; the queen twice (DD-104, section 5)      | 100.0%           | 8            | 100.0%           |

**Element matchups, First Blood** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 51.7% | 29.2%               | 47.5%               | 78.3%               | 59.2%               | 57.5%               |
| tide          | 70.8%               | mirror, white 35.0% | 67.5%               | 56.7%               | 87.5%               | 68.3%               |
| grove         | 52.5%               | 32.5%               | mirror, white 30.8% | 53.3%               | 63.3%               | 45.8%               |
| storm         | 21.7%               | 43.3%               | 46.7%               | mirror, white 36.7% | 55.8%               | 55.0%               |
| stone         | 40.8%               | 12.5%               | 36.7%               | 44.2%               | mirror, white 65.0% | 60.0%               |
| frost         | 42.5%               | 31.7%               | 54.2%               | 45.0%               | 40.0%               | mirror, white 51.7% |

Advantaged element: **48.3%**. White 50.8%, surprise losses 9.5%, median 24 plies. Result reasons: repetition 74, objective 1087, checkmate 94, ply_cap 5.

**Element matchups, Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 40.0% | 18.8%               | 76.3%               | 91.3%               | 65.0%               | 47.5%               |
| tide          | 81.3%               | mirror, white 51.2% | 20.0%               | 100.0%              | 92.5%               | 88.8%               |
| grove         | 23.8%               | 80.0%               | mirror, white 55.0% | 95.0%               | 47.5%               | 81.3%               |
| storm         | 8.8%                | 0.0%                | 5.0%                | mirror, white 45.0% | 7.5%                | 38.8%               |
| stone         | 35.0%               | 7.5%                | 52.5%               | 92.5%               | mirror, white 53.8% | 43.8%               |
| frost         | 52.5%               | 11.3%               | 18.8%               | 61.3%               | 56.3%               | mirror, white 53.8% |

Advantaged element: **70.8%**. White 51.3%, surprise losses 0.6%, median 69 plies. Result reasons: checkmate 616, repetition 190, stalemate 2, ply_cap 29, fifty_move 3.

**Build archetypes** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000` and `--format full --games 24`

**First Blood**

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 66.7%    | 55.8%   | 56.7%   |
| flexible      | 33.3%   | —        | 48.3%   | 65.0%   |
| focused       | 44.2%   | 51.7%    | —       | 76.7%   |
| starter       | 43.3%   | 35.0%    | 23.3%   | —       |

White 51.0%, surprise losses 31.4%, median 16 plies. Result reasons: objective 347, stalwart_captured 2, checkmate 8, repetition 3.

**Full Battle**

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 41.7%    | 83.3%   | 100.0%  |
| flexible      | 58.3%   | —        | 87.5%   | 95.8%   |
| focused       | 16.7%   | 12.5%    | —       | 89.6%   |
| starter       | 0.0%    | 4.2%     | 10.4%   | —       |

White 49.7%, surprise losses 10.3%, median 70 plies. Result reasons: stalwart_captured 8, repetition 28, fifty_move 2, checkmate 99, ply_cap 7.

**What changed.** The opening trap is gone. Storm's First Blood row falls from 97–100% against
four elements to 22–56%, the Storm mirror no longer loses for White by force (37% for White against
0%), and median length rises from 23 to 24 plies with 33 fewer battles decided by the objective and
33 more by checkmate. The element suite's advantaged score is unchanged at 48%, but its make-up moved:
Storm over Frost now reads 55% (inside the 55–60% target) and Stone over Storm 44%, where both were
decided by the trap before. Electric Slide on its own reads 72% in First Blood and 75% in Full Battle
(from 100% and 100%), the Stalwart band rather than its own league; its remaining First Blood wins are
one-turn bishop lines through a knight (`Bc5-d4-c3`, `Bc8-d7-b5` in the replays), which the opponent
cannot see until the first turn is observed. That is why surprise losses in the element suite rose
from 6.5% to 9.5%, still under the 15% target. The archetype tables are unchanged in kind: Maximum
leads First Blood at 56–67%, and the Stalwart king set still decides Full Battle (Maximum and
Flexible 83–88% over Focused).

**What it exposes.** Storm is now the weakest Full Battle element by a distance: 0–9% against Ember,
Tide, Grove and Stone and 39% against Frost (section 2 had 5–28% and 70%). The cause is finding 2 of
section 6, not the fix: every other Focused build spends its passive slot on army-wide Obstinate,
Storm's signature takes that slot, and a rook or bishop turn is worth little over 70 plies. The
remedy belongs to B5 (Obstinate at 2 slots and rule 9 narrow the gap for every build) and to the
designer's view of Storm's signature; a stronger attuned effect for Storm that does not reopen the
short format is the open design question, flagged with DD-106.

**For the next items.** B3 and B4 measure against the section 7 tables, not sections 2 and 4. The
`REACTIONS_ONLY` and archetype tables of sections 3 and 4 were not re-run: the fix touches one card,
and both knobs were inert with these builds.

## 8. The silence scope (B3, DD-108)

Plan item B3. Three scopes of the 6.2 knob measured on the same builds and seeds, with Pierce dealt
into every Focused build (`--prefer pierce`, new in this item) so the Capturing category carries a
card with an effect: `ALL_TRIGGERS` (the default), `REACTIONS_ONLY` and the new `ONCE_PER_ABILITY`
(each ability on each piece type is silenced once per battle; Resonance Crystal, which every Focused
build carries, then means never). 40 games per pairing in First Blood (about ±8 points per cell) and
30 in Full Battle (±9); the advantaged-element score aggregates 480 and 360 games.

The Focused builds with Pierce preferred: Ember Cleave, Last Word, Pierce, Obstinate, Squall; Tide
Hit and Run, Last Word, Pierce, Obstinate, Squall; Grove Poisoned Meat, Snowdrift, Pierce, Obstinate,
Last Word; Storm Electric Slide, Last Word, Snowdrift, Pierce, Squall; Stone Stonewall, Snowdrift,
Pierce, Obstinate, Last Word; Frost Frost Heave, Snowdrift, Pierce, Obstinate, Last Word.

**First Blood** — `pnpm sim --suite elements --format first_blood --games 40 --nodes 20000 --prefer pierce` with `--silence ALL_TRIGGERS`, `REACTIONS_ONLY` and `ONCE_PER_ABILITY`

_ALL_TRIGGERS_

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 57.5% | 23.8%               | 50.0%               | 85.0%               | 38.8%               | 66.3%               |
| tide          | 76.3%               | mirror, white 27.5% | 70.0%               | 67.5%               | 76.3%               | 78.8%               |
| grove         | 50.0%               | 30.0%               | mirror, white 65.0% | 55.0%               | 55.0%               | 61.3%               |
| storm         | 15.0%               | 32.5%               | 45.0%               | mirror, white 32.5% | 43.8%               | 52.5%               |
| stone         | 61.3%               | 23.8%               | 45.0%               | 56.3%               | mirror, white 40.0% | 61.3%               |
| frost         | 33.8%               | 21.3%               | 38.8%               | 47.5%               | 38.8%               | mirror, white 58.8% |

Advantaged element: **50.6%**. White 51.6%, surprise losses 12.4%, median 23 plies. Result reasons: repetition 43, objective 730, checkmate 63, fifty_move 1, ply_cap 3.

_REACTIONS_ONLY_

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 57.5% | 23.8%               | 47.5%               | 85.0%               | 38.8%               | 66.3%               |
| tide          | 76.3%               | mirror, white 27.5% | 81.3%               | 67.5%               | 76.3%               | 78.8%               |
| grove         | 52.5%               | 18.8%               | mirror, white 65.0% | 55.0%               | 55.0%               | 61.3%               |
| storm         | 15.0%               | 32.5%               | 45.0%               | mirror, white 32.5% | 43.8%               | 50.0%               |
| stone         | 61.3%               | 23.8%               | 45.0%               | 56.3%               | mirror, white 40.0% | 63.7%               |
| frost         | 33.8%               | 21.3%               | 38.8%               | 50.0%               | 36.3%               | mirror, white 58.8% |

Advantaged element: **47.5%**. White 51.2%, surprise losses 12.1%, median 23 plies. Result reasons: repetition 41, objective 735, checkmate 61, ply_cap 3.

_ONCE_PER_ABILITY_

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 57.5% | 23.8%               | 47.5%               | 85.0%               | 38.8%               | 66.3%               |
| tide          | 76.3%               | mirror, white 27.5% | 72.5%               | 67.5%               | 76.3%               | 78.8%               |
| grove         | 52.5%               | 27.5%               | mirror, white 65.0% | 55.0%               | 55.0%               | 61.3%               |
| storm         | 15.0%               | 32.5%               | 45.0%               | mirror, white 32.5% | 43.8%               | 45.0%               |
| stone         | 61.3%               | 23.8%               | 45.0%               | 56.3%               | mirror, white 40.0% | 65.0%               |
| frost         | 33.8%               | 21.3%               | 38.8%               | 55.0%               | 35.0%               | mirror, white 58.8% |

Advantaged element: **47.9%**. White 50.8%, surprise losses 12.2%, median 24 plies. Result reasons: repetition 43, objective 731, checkmate 63, ply_cap 3.

**Full Battle** — `pnpm sim --suite elements --format full --games 30 --nodes 20000 --prefer pierce` with the same three scopes

_ALL_TRIGGERS_

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 40.0% | 28.3%               | 68.3%               | 90.0%               | 36.7%               | 56.7%               |
| tide          | 71.7%               | mirror, white 46.7% | 35.0%               | 100.0%              | 88.3%               | 90.0%               |
| grove         | 31.7%               | 65.0%               | mirror, white 58.3% | 86.7%               | 41.7%               | 43.3%               |
| storm         | 10.0%               | 0.0%                | 13.3%               | mirror, white 33.3% | 3.3%                | 43.3%               |
| stone         | 63.3%               | 11.7%               | 58.3%               | 96.7%               | mirror, white 50.0% | 45.0%               |
| frost         | 43.3%               | 10.0%               | 56.7%               | 56.7%               | 55.0%               | mirror, white 45.0% |

Advantaged element: **66.7%**. White 47.9%, surprise losses 2.6%, median 74 plies. Result reasons: checkmate 460, repetition 153, ply_cap 15, fifty_move 2.

_REACTIONS_ONLY_

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 40.0% | 16.7%               | 61.7%               | 90.0%               | 36.7%               | 56.7%               |
| tide          | 83.3%               | mirror, white 46.7% | 91.7%               | 100.0%              | 88.3%               | 90.0%               |
| grove         | 38.3%               | 8.3%                | mirror, white 58.3% | 86.7%               | 41.7%               | 43.3%               |
| storm         | 10.0%               | 0.0%                | 13.3%               | mirror, white 33.3% | 11.7%               | 35.0%               |
| stone         | 63.3%               | 11.7%               | 58.3%               | 88.3%               | mirror, white 50.0% | 53.3%               |
| frost         | 43.3%               | 10.0%               | 56.7%               | 65.0%               | 46.7%               | mirror, white 45.0% |

Advantaged element: **53.9%**. White 48.4%, surprise losses 2.8%, median 71 plies. Result reasons: checkmate 472, repetition 141, ply_cap 15, fifty_move 2.

_ONCE_PER_ABILITY_

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 40.0% | 40.0%               | 60.0%               | 90.0%               | 36.7%               | 56.7%               |
| tide          | 60.0%               | mirror, white 46.7% | 91.7%               | 100.0%              | 88.3%               | 90.0%               |
| grove         | 40.0%               | 8.3%                | mirror, white 58.3% | 86.7%               | 41.7%               | 43.3%               |
| storm         | 10.0%               | 0.0%                | 13.3%               | mirror, white 33.3% | 10.0%               | 5.0%                |
| stone         | 63.3%               | 11.7%               | 58.3%               | 90.0%               | mirror, white 50.0% | 56.7%               |
| frost         | 43.3%               | 10.0%               | 56.7%               | 95.0%               | 43.3%               | mirror, white 45.0% |

Advantaged element: **44.4%**. White 49.0%, surprise losses 2.5%, median 70 plies. Result reasons: checkmate 478, repetition 136, fifty_move 4, ply_cap 12.

**Without the Crystal.** Every Focused build carries Resonance Crystal, which under
`ONCE_PER_ABILITY` means never silenced, so the runs above measure the scope and the item together.
The same two formats with the Crystal left out of every build (`--without resonance_crystal`, new in
this item; the slot stays empty) isolate the scope:

**First Blood** — `pnpm sim --suite elements --format first_blood --games 40 --nodes 20000 --prefer pierce --without resonance_crystal` with `--silence ALL_TRIGGERS` and `ONCE_PER_ABILITY`

_ALL_TRIGGERS_

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 57.5% | 21.3%               | 52.5%               | 85.0%               | 38.8%               | 66.3%               |
| tide          | 78.8%               | mirror, white 27.5% | 62.5%               | 67.5%               | 76.3%               | 78.8%               |
| grove         | 47.5%               | 37.5%               | mirror, white 65.0% | 55.0%               | 55.0%               | 61.3%               |
| storm         | 15.0%               | 32.5%               | 45.0%               | mirror, white 32.5% | 43.8%               | 62.5%               |
| stone         | 61.3%               | 23.8%               | 45.0%               | 56.3%               | mirror, white 40.0% | 56.3%               |
| frost         | 33.8%               | 21.3%               | 38.8%               | 37.5%               | 43.8%               | mirror, white 58.8% |

Advantaged element: **55.2%**. White 52.3%, surprise losses 10.9%, median 23 plies. Result reasons: repetition 48, objective 726, checkmate 63, ply_cap 3.

_ONCE_PER_ABILITY_

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 57.5% | 21.3%               | 51.2%               | 85.0%               | 38.8%               | 66.3%               |
| tide          | 78.8%               | mirror, white 27.5% | 66.3%               | 67.5%               | 76.3%               | 78.8%               |
| grove         | 48.8%               | 33.8%               | mirror, white 65.0% | 55.0%               | 55.0%               | 61.3%               |
| storm         | 15.0%               | 32.5%               | 45.0%               | mirror, white 32.5% | 43.8%               | 60.0%               |
| stone         | 61.3%               | 23.8%               | 45.0%               | 56.3%               | mirror, white 40.0% | 58.8%               |
| frost         | 33.8%               | 21.3%               | 38.8%               | 40.0%               | 41.3%               | mirror, white 58.8% |

Advantaged element: **53.5%**. White 52.3%, surprise losses 10.8%, median 23 plies. Result reasons: repetition 50, objective 725, checkmate 62, ply_cap 3.

**Full Battle** — the same with `--format full --games 30`

_ALL_TRIGGERS_

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 40.0% | 16.7%               | 81.7%               | 90.0%               | 36.7%               | 56.7%               |
| tide          | 83.3%               | mirror, white 46.7% | 20.0%               | 100.0%              | 88.3%               | 90.0%               |
| grove         | 18.3%               | 80.0%               | mirror, white 58.3% | 86.7%               | 41.7%               | 43.3%               |
| storm         | 10.0%               | 0.0%                | 13.3%               | mirror, white 33.3% | 5.0%                | 30.0%               |
| stone         | 63.3%               | 11.7%               | 58.3%               | 95.0%               | mirror, white 50.0% | 41.7%               |
| frost         | 43.3%               | 10.0%               | 56.7%               | 70.0%               | 58.3%               | mirror, white 45.0% |

Advantaged element: **71.4%**. White 46.9%, surprise losses 2.5%, median 72 plies. Result reasons: checkmate 477, repetition 133, ply_cap 16, stalemate 1, fifty_move 3.

_ONCE_PER_ABILITY_

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 40.0% | 20.0%               | 65.0%               | 90.0%               | 36.7%               | 56.7%               |
| tide          | 80.0%               | mirror, white 46.7% | 45.0%               | 100.0%              | 88.3%               | 90.0%               |
| grove         | 35.0%               | 55.0%               | mirror, white 58.3% | 86.7%               | 41.7%               | 43.3%               |
| storm         | 10.0%               | 0.0%                | 13.3%               | mirror, white 33.3% | 6.7%                | 20.0%               |
| stone         | 63.3%               | 11.7%               | 58.3%               | 93.3%               | mirror, white 50.0% | 43.3%               |
| frost         | 43.3%               | 10.0%               | 56.7%               | 80.0%               | 56.7%               | mirror, white 45.0% |

Advantaged element: **61.7%**. White 47.0%, surprise losses 2.8%, median 71 plies. Result reasons: checkmate 468, repetition 141, ply_cap 17, fifty_move 4.

**What the data says.**

1. **With a Capturing card that acts, the knob acts.** In First Blood the three scopes are within two
   points of each other (advantaged element 50.6%, 47.5%, 47.9%): the short format is decided by
   traits and openings before silence matters. In Full Battle the aggregate moves from 66.7%
   (`ALL_TRIGGERS`) to 53.9% (`REACTIONS_ONLY`) and 44.4% (`ONCE_PER_ABILITY` with the Crystal in
   every build), where section 3 had found it inert with Scout as the only Capturing card.
2. **`REACTIONS_ONLY` moves the lopsided pairs rather than flattening them.** Its 53.9% sits just
   under the 55–60% target, but the table behind it is not balanced: Grove over Tide falls from
   65% to 8% because Tide's Pierce, no longer silenced, negates Poisoned Meat on every capture, while
   Tide over Ember rises from 72% to 83%. Freeing Capturing cards hands the game to whoever carries
   the negation.
3. **`ONCE_PER_ABILITY` with Resonance Crystal is `OFF` for anyone who equips it.** Every Focused
   build carries the Crystal, so the 44.4% is a measurement of no silence at all: the foil's edge is
   gone and the kits decide, which means Tide (Flow, Hit and Run, Pierce) beats every element at
   60–100% in Full Battle and Storm loses 0–13% to four of them. Without the Crystal the picture changes: `ONCE_PER_ABILITY` reads 61.7% in Full Battle
   (`ALL_TRIGGERS` 71.4% on the same builds), the closest any scope comes to the 55–60% target, and
   53.5% in First Blood (55.2%). Its foil pairs are Tide over Ember 80%, Ember over Grove 65%, Grove
   over Tide 55%, Frost over Stone 57%, Stone over Storm 93% and Storm over Frost 20%: the last two
   are Storm's missing Obstinate slot (section 7), not the scope. The Crystal itself, under
   `ALL_TRIGGERS`, trims the foil's Full Battle edge by five points (71.4% to 66.7%), which is the
   job its text describes.
4. **What to ship.** The data favours `ONCE_PER_ABILITY`, on one condition: Resonance Crystal must
   not mean never under it, or the scope is `OFF` for every Crystal holder and the foil advantage
   inverts (44.4%). The default stays `ALL_TRIGGERS` in this item, and two things go to B5: the
   Crystal's reading under `ONCE_PER_ABILITY` (back to one spared silence per battle, as DD-30 had
   it, or a higher slot cost for "never") and Storm's slot. `REACTIONS_ONLY` is the scope the data
   argues against: it makes Pierce the best card in the game. The knob is now measurable in an
   afternoon (`--prefer pierce`, `--without resonance_crystal`), so B4 and B5 can re-run it after
   each change.

## 9. Two designer answers (B3b, DD-109, DD-110)

The designer answered two of the questions this report raised (2026-10-09): Stalwart on a king
should cost a slot, and Storm's signature should ship in its most balanced version. Both are measured
here with the method of sections 2–8; the mirror tests use 120 games in First Blood (about ±4.5
points) and 80 in Full Battle (±5.5), the finalists 300 and 200 (±2.9 and ±3.5), and the element and
archetype suites the counts of section 7, so every cell pairs with the one there.

### 9.1 Storm's signature: which pieces turn, and where

Electric Slide's attuned turn is now a config knob (`CAPS.ELECTRIC_SLIDE`: the slider types that turn
once per move, and whether any allied piece other than a pawn, any such piece other than a knight, or
only a piece that has left its starting square serves as the corner), so the variants run from
`pnpm sim --suite cards --cards electric_slide --caps '{"ELECTRIC_SLIDE":{...}}'` without a content
change. The base leap (a pawn over one adjacent ally) is the same in every row. Section 7's shipped
rule (DD-106) is the first row.

**The matrix** — `--format first_blood --games 120` and `--format full --games 80`, `--nodes 20000`

| Turning sliders       | Corners                       | First Blood (120) | Median plies | Full Battle (80) |
| --------------------- | ----------------------------- | ----------------- | ------------ | ---------------- |
| Rooks and bishops     | any piece but a pawn (DD-106) | 77.9%             | 14           | 71.9%            |
| Rooks                 | any piece but a pawn          | 55.0%             | 20           | 68.1%            |
| Bishops               | any piece but a pawn          | 87.9%             | 15           | 53.1%            |
| Rooks and bishops     | not a pawn or a knight        | 54.6%             | 22           | 66.9%            |
| Rooks and bishops     | a piece that has moved        | 88.3%             | 15           | 73.8%            |
| none (the leap alone) | —                             | 57.5%             | 21           | 57.5%            |
| Rooks                 | not a pawn or a knight        | 51.7%             | 22           | 66.9%            |
| Bishops               | not a pawn or a knight        | 61.3%             | 21           | 62.5%            |
| Rooks                 | a piece that has moved        | 60.4%             | 21           | 65.6%            |
| Bishops               | a piece that has moved        | 87.9%             | 15           | 53.8%            |

Bishop lines through a developed knight decide First Blood (bishops at any piece 88%, at pieces that
have moved 88%: the `Bc5-d4-c3` pattern of section 7), rook turns decide Full Battle (68–74%
whichever corners), and the leap alone is already a solid card (57.5% in both formats, the band the
other signatures sit in: 42–51% in First Blood and 52–77% in Full Battle, section 5). Four finalists
were re-run at 300 and 200 games (the same seed base, so the first 120 and 80 games are the rows
above):

**The finalists** — `--games 300` and `--games 200`

| Turning sliders   | Corners                | First Blood (300) | Median plies | Full Battle (200) |
| ----------------- | ---------------------- | ----------------- | ------------ | ----------------- |
| Rooks             | any piece but a pawn   | 55.8%             | 20           | 68.0%             |
| Rooks             | not a pawn or a knight | 57.2%             | 21           | 68.8%             |
| Rooks and bishops | not a pawn or a knight | 59.2%             | 21           | 70.0%             |
| Bishops           | not a pawn or a knight | 57.8%             | 21           | 64.0%             |

**The choice (DD-110; superseded the same day by the designer's own rule, DD-111, measured in section 10).** Bishops turning once at an allied bishop, rook, queen or king is the only
turning rule that adds no First Blood edge over the leap alone (57.8% against 57.5%) while keeping a
moderate Full Battle bonus (64.0%, between Cleave's 58% and Poisoned Meat's 77%); every rule that
lets rooks turn reads 68–70% in Full Battle, and every rule that lets bishops turn at knights reads
88% in First Blood. It ships as the default of `CAPS.ELECTRIC_SLIDE` (`turners: ['bishop']`,
`corners: 'no_knights'`); the DD-106 geometry stays one config line away, and the module's tests keep
exercising it through a caps override. The designer may prefer another row: each is one line.

With the shipped rule in every Storm build, the element and archetype suites of section 7 were
re-run (same seeds and counts).

**Element matchups, First Blood** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 51.7% | 29.2%               | 47.5%               | 81.7%               | 59.2%               | 57.5%               |
| tide          | 70.8%               | mirror, white 35.0% | 67.5%               | 68.3%               | 87.5%               | 68.3%               |
| grove         | 52.5%               | 32.5%               | mirror, white 30.8% | 63.3%               | 63.3%               | 45.8%               |
| storm         | 18.3%               | 31.7%               | 36.7%               | mirror, white 57.5% | 41.7%               | 32.5%               |
| stone         | 40.8%               | 12.5%               | 36.7%               | 58.3%               | mirror, white 65.0% | 60.0%               |
| frost         | 42.5%               | 31.7%               | 54.2%               | 67.5%               | 40.0%               | mirror, white 51.7% |

Advantaged element: **46.9%**. White 52.1%, surprise losses 10.2%, median 25 plies. Result reasons: repetition 83, objective 1070, checkmate 102, ply_cap 5.

**Element matchups, Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 40.0% | 18.8%               | 76.3%               | 92.5%               | 65.0%               | 47.5%               |
| tide          | 81.3%               | mirror, white 51.2% | 20.0%               | 100.0%              | 92.5%               | 88.8%               |
| grove         | 23.8%               | 80.0%               | mirror, white 55.0% | 91.3%               | 47.5%               | 81.3%               |
| storm         | 7.5%                | 0.0%                | 8.8%                | mirror, white 53.8% | 1.3%                | 23.8%               |
| stone         | 35.0%               | 7.5%                | 52.5%               | 98.8%               | mirror, white 53.8% | 43.8%               |
| frost         | 52.5%               | 11.3%               | 18.8%               | 76.3%               | 56.3%               | mirror, white 53.8% |

Advantaged element: **69.4%**. White 52.1%, surprise losses 0.5%, median 68 plies. Result reasons: checkmate 610, repetition 196, ply_cap 29, stalemate 2, fifty_move 3.

**What changed.** Storm's First Blood row falls from 22–56% (section 7) to 18–42% and its Full
Battle row from 0–39% to 0–24%: a bishop turn is worth less than a rook turn over 70 plies, so the
signature change costs Storm about ten points where it was already weakest, for the reason section 7
gives (its passive slot holds the signature where every other Focused build holds Obstinate). The
aggregates barely move: advantaged element 46.9% (48.3%) in First Blood and 69.4% (70.8%) in Full
Battle, surprise losses 10.2% and 0.5%, medians 25 and 68 plies. Stone over Storm reads 58% in First
Blood (44% before) and Storm over Frost 33% (55%): the two Storm pairs of the wheel now read like
their Full Battle counterparts, the slot problem rather than the opening. B5 (Storm's slot,
Obstinate's cost) is where Storm's row moves next.

### 9.2 Stalwart on a king costs an item slot (rule 9)

> **Overruled.** The designer reverted rule 9 the same day (B3c, DD-111): Stalwart costs one ability
> slot and nothing else; it simply means only a direct capture removes the piece. The measurements
> below stay as the record of what an item-slot price would have done.

The designer's answer: yes, Stalwart on a king should cost a slot. An ability slot would cost nothing
in practice, because a per-type king set has nothing better to hold (Captured cards and Obstinate are
inert on a king, section 1), while finding 3 showed that king set deciding Full Battle between
archetypes. So the slot is an item slot (7.4 rule 9, DD-109): `kingItemSlots` is module data
(Stalwart: 1), added to rule 1's total when the set that applies to the king holds it (the sixth
per-type set, or the army-wide set). The total stays public under 8.1, deductions treat an unrevealed
king slot as either an item or the king's cost until Stalwart is seen on the king, and the loadout
builder shows the slot in its meter.

At level 25 every 7.3 build uses all six item slots, so a Stalwart king now costs Maximum its Blended
Family (and second element) and Flexible its Resonance Crystal; the simulator plays both answers:
`--king plain` (the 7.3 item lists, no Stalwart anywhere) and `--king stalwart` (the king set leads
with Stalwart and the build pays). Focused and Starter never carry it (rule 8 would strip an
army-wide set of its offensive cards). The mirror test for Stalwart itself pays the slot too: the
side carrying the card gives up Scout's Lens.

**Stalwart alone, paying its slot** — `pnpm sim --suite cards --cards stalwart --format first_blood --games 36 --nodes 20000` and `--format full --games 24`

| Format      | Card     | Category | Level | Score with the card | Games | Median plies | Note          |
| ----------- | -------- | -------- | ----- | ------------------- | ----- | ------------ | ------------- |
| First Blood | Stalwart | PASSIVE  | 16    | 61.1%               | 36    | 11           | **above 60%** |
| Full Battle | Stalwart | PASSIVE  | 16    | 81.3%               | 24    | 68           | **above 60%** |

**Build archetypes** — the 7.3 item lists first (`--king plain`, the default), then with the Stalwart king paid for (`--king stalwart`: Maximum without Blended Family, Flexible without the Crystal).

**First Blood, the 7.3 item lists, no Stalwart** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 68.3%    | 49.2%   | 58.3%   |
| flexible      | 31.7%   | —        | 44.2%   | 60.0%   |
| focused       | 50.8%   | 55.8%    | —       | 84.2%   |
| starter       | 41.7%   | 40.0%    | 15.8%   | —       |

White 50.7%, surprise losses 22.5%, median 19 plies. Result reasons: objective 340, checkmate 11, repetition 8, ply_cap 1.

**First Blood, Stalwart kings paid for** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000 --king stalwart`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 66.7%    | 58.3%   | 58.3%   |
| flexible      | 33.3%   | —        | 53.3%   | 66.7%   |
| focused       | 41.7%   | 46.7%    | —       | 84.2%   |
| starter       | 41.7%   | 33.3%    | 15.8%   | —       |

White 49.6%, surprise losses 27.3%, median 18 plies. Result reasons: objective 348, checkmate 6, repetition 5, stalwart_captured 1.

**Full Battle, the 7.3 item lists, no Stalwart** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 50.0%    | 68.8%   | 97.9%   |
| flexible      | 50.0%   | —        | 64.6%   | 95.8%   |
| focused       | 31.3%   | 35.4%    | —       | 87.5%   |
| starter       | 2.1%    | 4.2%     | 12.5%   | —       |

White 49.7%, surprise losses 7.2%, median 64 plies. Result reasons: repetition 28, checkmate 111, ply_cap 4, fifty_move 1.

**Full Battle, Stalwart kings paid for** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000 --king stalwart`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 41.7%    | 81.3%   | 91.7%   |
| flexible      | 58.3%   | —        | 87.5%   | 93.8%   |
| focused       | 18.8%   | 12.5%    | —       | 87.5%   |
| starter       | 8.3%    | 6.3%     | 12.5%   | —       |

White 51.4%, surprise losses 12.0%, median 70 plies. Result reasons: stalwart_captured 13, ply_cap 8, repetition 26, checkmate 95, fifty_move 2.

### 9.3 What the data says

1. **Storm's signature is in the band.** The shipped Electric Slide reads 57.8% in First Blood and
   64.0% in Full Battle on its own (section 5 had 100% and 100%, section 7 72% and 75%). Its First
   Blood score is the leap's: the attuned bishop turn adds nothing there, which is the point. In
   Full Battle it sits between Cleave and Poisoned Meat. In the element suite Storm pays for the weaker turn where it was already weakest (its Full Battle
   row 0–24% from 0–39%, its First Blood row 18–42% from 22–56%), which is the passive-slot problem
   of section 7 and B5's to fix, not the signature's.
2. **The Stalwart king now has a price, and one item slot is not it.** Paying Scout's Lens for the
   card moves its mirror score from 69% to 61% in First Blood and leaves Full Battle at 81%: a king
   that must be caught is worth far more than a utility item over 70 plies. The archetype suite says
   the same. Without Stalwart (the 7.3 item lists) Maximum and Flexible are level (50% each way in
   Full Battle, 68% for Maximum in First Blood) and beat Focused 65–69% in Full Battle, down from
   83–88%; with the king paid for (Maximum without Blended Family, Flexible without the Crystal)
   they beat Focused 81–88% again, exactly section 7's numbers, and a quarter of those games end in
   `stalwart_captured`. Rule 9 makes the choice visible and costed; it does not yet make Focused
   competitive with a Stalwart king. The levers left are B5's: at most two passives per set (rule 10) takes Block Path or Veil off the king, Obstinate at two slots narrows the per-type edge, and
   the designer can raise the king's cost to two item slots in one line of module data.
3. **Archetype target.** Maximum against Flexible is inside 45–55% in Full Battle under either king
   rule (50% and 42–58%); Maximum over Flexible in First Blood stays at 67–68% (section 7: 67%),
   which is the second element and the fifth selections at work, not the king. Focused against the
   Schedule builds misses in Full Battle (31–35% without Stalwart, 13–19% against a paid Stalwart
   king) and is level in First Blood (41–56%).
4. **What ships.** Rule 9 and the bishops-only Electric Slide, both PLAYTEST: the loadout builder
   shows the king's slot, the simulator plays both king answers (`--king`) and every Electric Slide
   variant above is one `--caps` line, so B4 and B5 can re-measure either in minutes. The designer
   may overrule either decision; DD-109 and DD-110 record the alternatives measured.

## 10. The designer's rulings and the trait numbers (B3c, B4; DD-111 to DD-115)

The designer answered section 9 on 2026-10-09: rule 9 is reverted (Stalwart simply means only a
direct capture removes the piece; it costs one ability slot), and Electric Slide gets the designer's
own turn rule rather than a measured variant. B4 then turns the four trait numbers of the brief into
config knobs (`CAPS.TRAITS`) and measures each. Same method and seeds as before; the element suites
use 40 games per pairing in First Blood (about ±8 points per cell) and 30 in Full Battle (±9) for the
one-knob runs and 60 and 40 for the shipped defaults, so the last tables pair with sections 7 and 9.

### 10.1 Electric Slide, the designer's rule (DD-111)

Rooks and bishops turn once at an allied piece of equal or higher rank than themselves (5.1: a rook at
a rook or queen; a bishop at a knight, bishop, rook or queen), the queen twice at allied rooks and
bishops, nothing at the king or at a pawn. The engine's corner flag is now per slider type, so a
knight conducts a bishop and blocks a rook.

**Electric Slide alone** — `pnpm sim --suite cards --cards electric_slide --format first_blood --games 300 --nodes 20000` and `--format full --games 200`

| Format      | Card           | Category | Level | Score with the card | Games | Median plies | Note          |
| ----------- | -------------- | -------- | ----- | ------------------- | ----- | ------------ | ------------- |
| First Blood | Electric Slide | PASSIVE  | 3     | 82.5%               | 300   | 12           | **above 60%** |
| Full Battle | Electric Slide | PASSIVE  | 3     | 62.3%               | 200   | 63           | **above 60%** |

The Full Battle number sits where the bishops-only variant did (64%); the First Blood number is the
knight's doing: under the DD-97 rank order a knight equals a bishop, so a bishop turns at a developed
knight and the `Bc5-d4-c3` lines of section 7 return (bishops at any piece read 88% in section 9.1,
the leap alone 57.5%). Median length 12 plies, against 20–22 for the rules without that corner. This
is the designer's rule and ships as given; the one-line variant that keeps everything else and takes
the knight out of a bishop's corners is the measured 57.8% / 64.0% of section 9.1.

### 10.2 Trait numbers (B4)

| Trait (element)       | Launch value                       | B4 value (`CAPS.TRAITS`)                          |
| --------------------- | ---------------------------------- | ------------------------------------------------- |
| Flow (Tide)           | passes any number of allied pieces | passes at most one per move (`FLOW_PASS_LIMIT` 1) |
| Bulwark (Stone)       | every Stone piece                  | non-pawns only (`BULWARK_PAWNS` false)            |
| Overabundance (Grove) | double charges                     | one extra charge (`OVERABUNDANCE` add 1)          |
| Hot Foot (Ember)      | 3 opponent turns                   | 4 opponent turns (`HOT_FOOT_TURNS` 4)             |

Each knob was measured alone against the launch values (`--caps` with the other three at their launch
values), then all four together at the shipped defaults.

**First Blood: advantaged element and the six foil pairs** (row element over its foil; `--suite elements` at 40 / 30 games per pairing, the shipped row at 60 / 40)

| Run                | Advantaged | tide > ember | ember > grove | grove > tide | storm > frost | frost > stone | stone > storm | White | Surprise | Median |
| ------------------ | ---------- | ------------ | ------------- | ------------ | ------------- | ------------- | ------------- | ----- | -------- | ------ |
| launch values      | **52.1%**  | 76.3%        | 56.3%         | 31.3%        | 67.5%         | 43.8%         | 37.5%         | 52.1% | 9.2%     | 22     |
| Flow passes one    | **50.6%**  | 68.8%        | 56.3%         | 30.0%        | 67.5%         | 43.8%         | 37.5%         | 53.0% | 9.3%     | 22     |
| Bulwark non-pawns  | **52.1%**  | 76.3%        | 56.3%         | 31.3%        | 67.5%         | 43.8%         | 37.5%         | 52.5% | 9.3%     | 22     |
| Overabundance +1   | **52.1%**  | 76.3%        | 56.3%         | 31.3%        | 67.5%         | 43.8%         | 37.5%         | 52.1% | 9.2%     | 22     |
| Hot Foot 4 turns   | **52.1%**  | 76.3%        | 56.3%         | 31.3%        | 67.5%         | 43.8%         | 37.5%         | 52.1% | 9.2%     | 22     |
| all four (shipped) | **48.3%**  | 68.3%        | 47.5%         | 35.0%        | 60.0%         | 40.0%         | 39.2%         | 54.4% | 9.6%     | 23     |

**Full Battle: advantaged element and the six foil pairs** (row element over its foil; `--suite elements` at 40 / 30 games per pairing, the shipped row at 60 / 40)

| Run                | Advantaged | tide > ember | ember > grove | grove > tide | storm > frost | frost > stone | stone > storm | White | Surprise | Median |
| ------------------ | ---------- | ------------ | ------------- | ------------ | ------------- | ------------- | ------------- | ----- | -------- | ------ |
| launch values      | **69.2%**  | 80.0%        | 81.7%         | 73.3%        | 41.7%         | 46.7%         | 91.7%         | 52.8% | 0.8%     | 67     |
| Flow passes one    | **72.2%**  | 86.7%        | 81.7%         | 85.0%        | 41.7%         | 46.7%         | 91.7%         | 53.3% | 0.8%     | 67     |
| Bulwark non-pawns  | **69.2%**  | 80.0%        | 81.7%         | 73.3%        | 41.7%         | 46.7%         | 91.7%         | 53.1% | 0.8%     | 67     |
| Overabundance +1   | **69.2%**  | 80.0%        | 81.7%         | 73.3%        | 41.7%         | 46.7%         | 91.7%         | 52.8% | 0.8%     | 67     |
| Hot Foot 4 turns   | **68.9%**  | 80.0%        | 80.0%         | 73.3%        | 41.7%         | 46.7%         | 91.7%         | 52.2% | 0.8%     | 67     |
| all four (shipped) | **73.5%**  | 88.8%        | 77.5%         | 76.3%        | 47.5%         | 56.3%         | 95.0%         | 51.5% | 1.1%     | 66     |

**Element matchups at the shipped defaults, First Blood** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 51.7% | 31.7%               | 47.5%               | 66.7%               | 59.2%               | 59.2%               |
| tide          | 68.3%               | mirror, white 50.0% | 65.0%               | 63.3%               | 83.3%               | 70.8%               |
| grove         | 52.5%               | 35.0%               | mirror, white 30.8% | 35.0%               | 64.2%               | 45.8%               |
| storm         | 33.3%               | 36.7%               | 65.0%               | mirror, white 41.7% | 60.8%               | 60.0%               |
| stone         | 40.8%               | 16.7%               | 35.8%               | 39.2%               | mirror, white 65.0% | 60.0%               |
| frost         | 40.8%               | 29.2%               | 54.2%               | 40.0%               | 40.0%               | mirror, white 51.7% |

Advantaged element: **48.3%**. White 54.4%, surprise losses 9.6%, median 23 plies. Result reasons: repetition 65, objective 1099, checkmate 89, ply_cap 7.

**Element matchups at the shipped defaults, Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 40.0% | 11.3%               | 77.5%               | 100.0%              | 68.8%               | 56.3%               |
| tide          | 88.8%               | mirror, white 61.3% | 23.8%               | 98.8%               | 92.5%               | 77.5%               |
| grove         | 22.5%               | 76.3%               | mirror, white 55.0% | 88.8%               | 70.0%               | 81.3%               |
| storm         | 0.0%                | 1.3%                | 11.3%               | mirror, white 46.3% | 5.0%                | 47.5%               |
| stone         | 31.3%               | 7.5%                | 30.0%               | 95.0%               | mirror, white 53.8% | 43.8%               |
| frost         | 43.8%               | 22.5%               | 18.8%               | 52.5%               | 56.3%               | mirror, white 53.8% |

Advantaged element: **73.5%**. White 51.5%, surprise losses 1.1%, median 66 plies. Result reasons: checkmate 628, repetition 176, stalemate 4, ply_cap 27, fifty_move 5.

**Build archetypes at the shipped defaults, First Blood** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 62.5%    | 58.3%   | 58.3%   |
| flexible      | 37.5%   | —        | 58.3%   | 65.0%   |
| focused       | 41.7%   | 41.7%    | —       | 80.0%   |
| starter       | 41.7%   | 35.0%    | 20.0%   | —       |

White 47.4%, surprise losses 33.2%, median 17 plies. Result reasons: objective 343, stalwart_captured 2, repetition 5, checkmate 10.

**Build archetypes at the shipped defaults, Full Battle** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 56.3%    | 81.3%   | 100.0%  |
| flexible      | 43.8%   | —        | 87.5%   | 93.8%   |
| focused       | 18.8%   | 12.5%    | —       | 91.7%   |
| starter       | 0.0%    | 6.3%     | 8.3%    | —       |

White 52.4%, surprise losses 14.4%, median 66 plies. Result reasons: stalwart_captured 13, repetition 24, ply_cap 7, checkmate 98, fifty_move 2.

**What the data says.**

1. **The simulator is deterministic and each knob moves only its own pairings.** Comparing the
   per-pairing outcome sets of the one-knob runs with the launch run: the Flow knob changes every
   Tide pairing and nothing else, the Bulwark knob only Grove-Stone and Ember-Stone (the two foils
   whose Poisoned Meat and Cleave hit Stone pawns), the Hot Foot knob only Ember's pairings, and the
   Overabundance knob changes no game at all, because no Focused build carries a consumable (the
   picker's top cards of every element have no charges). Overabundance's new value is therefore
   unmeasured here; the cards suite (section 5) is where Momentum, Snowbound and the revives show it.
2. **Flow's cap does not tame Tide.** With one allied piece per move Tide over Ember falls from 76%
   to 69% in First Blood, but Tide's row otherwise rises (80% over Stone from 73%, 86% over Frost from
   75%), and in Full Battle Tide over Ember rises to 87% while Grove over Tide, its foil, climbs from
   73% to 85%. The aggregate moves from 52.1% to 50.6% in First Blood and from 69.2% to 72.2% in Full
   Battle. Tide's strength is its kit (Hit and Run, Pierce, Obstinate on the Focused build), not the
   number of allies a slider passes; the cap removes the long double-crossings the NPC used to walk
   into and otherwise changes little. B5's card changes (Pierce at two charges, Obstinate at two
   slots) are the Tide lever; the Flow number is now a knob either way.
3. **Bulwark without pawns and Hot Foot at four turns are inert at this resolution.** Both leave the
   aggregates where they were (52.1% / 69.2% and 52.1% / 68.9%); Ember over Grove in Full Battle moves
   from 81.7% to 80.0% with the longer burn and Stone's pairs do not move at all at 40 and 30 games.
   The changes are kept as the designer's brief asks (they are PLAYTEST numbers behind one knob each),
   and they do no harm; they are not where the balance lives.
4. **The shipped defaults.** All four knobs together, at 60 and 40 games (so the tables pair with sections 7 and 9): advantaged
   element 48.3% in First Blood and 73.5% in Full Battle (sections 7 and 9: 48.3% / 46.9% and 70.8% /
   69.4%), White 54.4% and 51.5%, surprise losses 9.6% and 1.1%, medians 23 and 66 plies. The wheel
   points the right way in Full Battle for five pairs (Tide over Ember 89%, Ember over Grove 78%, Grove
   over Tide 76%, Frost over Stone 56%, Stone over Storm 95%) and Storm over Frost reads 48%; in First
   Blood only Tide over Ember (68%) and Storm over Frost (60%) do, Stone over Storm reads 39% (the
   DD-111 bishop turn) and Frost over Stone 40%. Tide's row (63–83% in First Blood, 78–99% in Full
   Battle except its foil) and Storm's Full Battle row (0–11% against four elements) are unchanged in
   kind. Archetypes (with Stalwart kings back on the Schedule builds): Maximum over Focused 58.3% and
   Flexible over Focused 58.3% in First Blood, 81.3% and 87.5% in Full Battle, Maximum against Flexible
   62.5% and 56.3%: the Stalwart king set still decides Full Battle (section 9.3), which the designer has
   chosen to keep as it is; the two-passive rule of B5 is the lever left.
5. **Storm after DD-111.** The designer's Electric Slide rule puts a bishop's turn at a knight back
   in: Storm over Stone reads 62.5% in First Blood where section 9 (bishops at non-knights) had 42%,
   and the mirror test reads 82.5% (section 10.1). Storm's Full Battle row stays the weakest (the
   Obstinate slot, section 7); both are B5's.

## 11. Per-card changes and loadout rule 9 (B5; DD-116 to DD-120)

Plan item B5, the designer's per-card changes measured on the same seeds: Obstinate costs two slots
and kings ignore it; Block Path costs two slots and a king faces forward again after it moves; Redo
is not eligible on pawns; Pierce has two charges; Scout's Lens reveals the whole pawn set; Resonance
Crystal spares one silence under every scope (the B3 condition); and loadout rule 9, at most two
Passive abilities per set (`CAPS.MAX_PASSIVES_PER_SET`), which cuts the Stalwart king set to Stalwart
plus one. The simulator's picker deals a `--prefer` card right after the signature, so `--prefer
obstinate` puts Obstinate into every Focused build, Storm's included (section 7's finding 2).

**The changed cards alone, First Blood** — `pnpm sim --suite cards --cards obstinate,block_path,pierce,redo --format first_blood --games 36 --nodes 20000` (a two-slot card displaces two cards on its side)

| Card       | Category  | Level | Score with the card | Games | Median plies | Note          |
| ---------- | --------- | ----- | ------------------- | ----- | ------------ | ------------- |
| Obstinate  | PASSIVE   | 9     | 79.2%               | 36    | 16           | **above 60%** |
| Pierce     | CAPTURING | 3     | 69.4%               | 36    | 16           | **above 60%** |
| Block Path | PASSIVE   | 12    | 58.3%               | 36    | 19           |               |
| Redo       | CAPTURED  | 15    | 55.6%               | 36    | 19           |               |

**The changed cards alone, Full Battle** — `pnpm sim --suite cards --cards obstinate,block_path,pierce,redo --format full --games 24 --nodes 20000` (a two-slot card displaces two cards on its side)

| Card       | Category  | Level | Score with the card | Games | Median plies | Note                    |
| ---------- | --------- | ----- | ------------------- | ----- | ------------ | ----------------------- |
| Obstinate  | PASSIVE   | 9     | 72.9%               | 24    | 106          | **above 60%**           |
| Block Path | PASSIVE   | 12    | 60.4%               | 24    | 96           | **above 60%**           |
| Pierce     | CAPTURING | 3     | 54.2%               | 24    | 68           |                         |
| Redo       | CAPTURED  | 15    | 33.3%               | 24    | 102          | below 40% (a liability) |

**Element matchups, First Blood, the shipped defaults** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 41.7% | 35.8%               | 49.2%               | 65.0%               | 45.8%               | 45.0%               |
| tide          | 64.2%               | mirror, white 33.3% | 53.3%               | 65.0%               | 81.7%               | 76.7%               |
| grove         | 50.8%               | 46.7%               | mirror, white 52.5% | 30.8%               | 66.7%               | 60.8%               |
| storm         | 35.0%               | 35.0%               | 69.2%               | mirror, white 48.3% | 71.7%               | 68.3%               |
| stone         | 54.2%               | 18.3%               | 33.3%               | 28.3%               | mirror, white 55.0% | 49.2%               |
| frost         | 55.0%               | 23.3%               | 39.2%               | 31.7%               | 50.8%               | mirror, white 52.5% |

Advantaged element: **51.2%**. White 48.1%, surprise losses 0.0%, median 23 plies. Result reasons: objective 1172, repetition 50, checkmate 32, ply_cap 6.

**Element matchups, Full Battle, the shipped defaults** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 45.0% | 22.5%               | 70.0%               | 73.8%               | 41.3%               | 53.8%               |
| tide          | 77.5%               | mirror, white 51.2% | 20.0%               | 100.0%              | 56.3%               | 65.0%               |
| grove         | 30.0%               | 80.0%               | mirror, white 48.8% | 91.3%               | 63.7%               | 65.0%               |
| storm         | 26.3%               | 0.0%                | 8.8%                | mirror, white 53.8% | 17.5%               | 70.0%               |
| stone         | 58.8%               | 43.8%               | 36.3%               | 82.5%               | mirror, white 53.8% | 45.0%               |
| frost         | 46.3%               | 35.0%               | 35.0%               | 30.0%               | 55.0%               | mirror, white 51.2% |

Advantaged element: **72.5%**. White 50.7%, surprise losses 0.0%, median 110 plies. Result reasons: checkmate 399, repetition 328, ply_cap 100, stalemate 2, fifty_move 11.

**Element matchups, First Blood, Obstinate in every Focused build (`--prefer obstinate`)** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000 --prefer obstinate`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 41.7% | 35.8%               | 49.2%               | 17.5%               | 45.8%               | 45.0%               |
| tide          | 64.2%               | mirror, white 33.3% | 53.3%               | 36.7%               | 81.7%               | 76.7%               |
| grove         | 50.8%               | 46.7%               | mirror, white 52.5% | 15.0%               | 66.7%               | 60.8%               |
| storm         | 82.5%               | 63.3%               | 85.0%               | mirror, white 53.3% | 85.0%               | 81.7%               |
| stone         | 54.2%               | 18.3%               | 33.3%               | 15.0%               | mirror, white 55.0% | 49.2%               |
| frost         | 55.0%               | 23.3%               | 39.2%               | 18.3%               | 50.8%               | mirror, white 52.5% |

Advantaged element: **51.2%**. White 49.0%, surprise losses 0.0%, median 23 plies. Result reasons: objective 1194, repetition 50, checkmate 10, ply_cap 6.

**Element matchups, Full Battle, Obstinate in every Focused build (`--prefer obstinate`)** — `pnpm sim --suite elements --format full --games 40 --nodes 20000 --prefer obstinate`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 45.0% | 22.5%               | 70.0%               | 60.0%               | 41.3%               | 53.8%               |
| tide          | 77.5%               | mirror, white 51.2% | 20.0%               | 71.3%               | 56.3%               | 65.0%               |
| grove         | 30.0%               | 80.0%               | mirror, white 48.8% | 70.0%               | 63.7%               | 65.0%               |
| storm         | 40.0%               | 28.7%               | 30.0%               | mirror, white 46.3% | 60.0%               | 61.3%               |
| stone         | 58.8%               | 43.8%               | 36.3%               | 40.0%               | mirror, white 53.8% | 45.0%               |
| frost         | 46.3%               | 35.0%               | 35.0%               | 38.8%               | 55.0%               | mirror, white 51.2% |

Advantaged element: **64.0%**. White 49.7%, surprise losses 0.0%, median 134 plies. Result reasons: checkmate 313, repetition 391, ply_cap 120, stalemate 2, fifty_move 14.

**Element matchups, First Blood, `ONCE_PER_ABILITY` with Pierce preferred and the Crystal sparing one silence** — `pnpm sim --suite elements --format first_blood --games 40 --nodes 20000 --silence ONCE_PER_ABILITY --prefer pierce`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 43.8% | 33.8%               | 71.3%               | 77.5%               | 52.5%               | 40.0%               |
| tide          | 66.3%               | mirror, white 51.2% | 57.5%               | 62.5%               | 71.3%               | 85.0%               |
| grove         | 28.7%               | 42.5%               | mirror, white 48.8% | 45.0%               | 58.8%               | 46.3%               |
| storm         | 22.5%               | 37.5%               | 55.0%               | mirror, white 50.0% | 57.5%               | 67.5%               |
| stone         | 47.5%               | 28.7%               | 41.3%               | 42.5%               | mirror, white 41.3% | 42.5%               |
| frost         | 60.0%               | 15.0%               | 53.8%               | 32.5%               | 57.5%               | mirror, white 50.0% |

Advantaged element: **57.9%**. White 47.7%, surprise losses 0.0%, median 23 plies. Result reasons: objective 763, repetition 52, checkmate 22, ply_cap 3.

**Element matchups, Full Battle, `ONCE_PER_ABILITY` with Pierce preferred and the Crystal sparing one silence** — `pnpm sim --suite elements --format full --games 30 --nodes 20000 --silence ONCE_PER_ABILITY --prefer pierce`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 46.7% | 21.7%               | 68.3%               | 83.3%               | 68.3%               | 51.7%               |
| tide          | 78.3%               | mirror, white 46.7% | 41.7%               | 96.7%               | 78.3%               | 66.7%               |
| grove         | 31.7%               | 58.3%               | mirror, white 46.7% | 76.7%               | 43.3%               | 46.7%               |
| storm         | 16.7%               | 3.3%                | 23.3%               | mirror, white 51.7% | 20.0%               | 36.7%               |
| stone         | 31.7%               | 21.7%               | 56.7%               | 80.0%               | mirror, white 53.3% | 46.7%               |
| frost         | 48.3%               | 33.3%               | 53.3%               | 63.3%               | 53.3%               | mirror, white 51.7% |

Advantaged element: **62.5%**. White 51.9%, surprise losses 0.0%, median 111 plies. Result reasons: checkmate 320, repetition 242, fifty_move 11, ply_cap 55, stalemate 2.

**Build archetypes, First Blood** (rule 9: the king set is Stalwart plus one passive) — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 51.7%    | 65.0%   | 66.7%   |
| flexible      | 48.3%   | —        | 40.8%   | 45.0%   |
| focused       | 35.0%   | 59.2%    | —       | 81.7%   |
| starter       | 33.3%   | 55.0%    | 18.3%   | —       |

White 48.5%, surprise losses 30.4%, median 15 plies. Result reasons: objective 348, stalwart_captured 6, repetition 5, checkmate 1.

**Build archetypes, Full Battle** (rule 9: the king set is Stalwart plus one passive) — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 47.9%    | 72.9%   | 83.3%   |
| flexible      | 52.1%   | —        | 52.1%   | 87.5%   |
| focused       | 27.1%   | 47.9%    | —       | 89.6%   |
| starter       | 16.7%   | 12.5%    | 10.4%   | —       |

White 55.6%, surprise losses 12.9%, median 78 plies. Result reasons: stalwart_captured 36, repetition 26, checkmate 80, ply_cap 2.

**What the data says.**

1. **The changed cards alone.** Obstinate at two slots reads 79.2% in First Blood and 72.9% in Full
   Battle (section 5: 88.9% and 95.8%); the mirror now pairs it against the two one-slot cards its
   second slot displaces (Squall and Snowdrift in Ember's and Tide's builds, Last Word and Reinforce
   in Grove's, Stone's and Frost's), and it is still the only card above 60% in both formats. Block
   Path at two slots reads 58.3% and 60.4% (50.0% and 72.9%): a king that faces forward again after
   it moves costs the card a third of its Full Battle edge, and against the two-slot Obstinate as its
   filler it no longer wins on its own in either format by more than a game. Pierce at two charges
   reads 69.4% and 54.2% (54.2% and 47.9%): the second charge makes it a First Blood card that wins by
   itself, since the Focused build's first two captures are the ones that decide that format, and
   leaves Full Battle where a Capturing card belongs. Redo without pawns reads 55.6% and 33.3% (61.1%
   and 37.5%): the pawn exclusion takes away its First Blood edge and leaves the Full Battle liability
   (a second move for a piece the opponent has just chosen to take), so Redo is the one B5 card the
   change did not help; it goes to B8 with the new cards as a candidate for a rework rather than a
   price.
2. **Element matchups at the defaults.** With Obstinate at two slots every Focused build (Storm's
   aside) carries four cards instead of five, and the advantaged element reads 51.2% in First Blood
   (section 10: 48.3%) and 72.5% in Full Battle (73.5%); White 48.1% and 50.7%. Tide's row is
   unchanged in kind (53–82% in First Blood, 56–100% in Full Battle except its foil), and Storm's Full
   Battle row is still the weakest (0–26% against four elements, 70% over Frost, from 0–11% and 48%):
   Obstinate's price did not take it out of the other five builds, and Storm still cannot hold it
   beside its signature without `--prefer`. Full Battle games are much longer: median 110 plies from
   66, 100 of 1,260 reach the ply cap (27 before) and 328 end by repetition (176): a side whose
   pieces cannot be taken by higher ranks and whose build has one reaction fewer has less to force
   with, and the NPCs shuffle. That is a cost of the two-slot shield worth a look in B8 when the live
   clocks are set.
3. **Surprise losses read 0.0% by construction in the element and cards suites.** Scout's Lens now
   reveals the opponent's whole pawn set at battle start, every Focused build carries the Lens, and a
   Focused build has one army-wide set: both sides know each other's entire set from the first ply, so
   the 17.2 "unseen ability" metric has nothing left to count (9.6% and 1.1% in section 10). The
   figure is real, not a tooling fault, and it says something about the item: against a Lens a
   one-set army is an open book, while Maximum and Flexible builds (per-type sets) give it eight
   pawns' worth of cards and keep the rest hidden. The archetype suite is where the metric still
   reads (30.4% in First Blood and 12.9% in Full Battle, from 33.2% and 14.4% in section 10).
4. **Obstinate in every Focused build (`--prefer obstinate`).** `--prefer obstinate` changes only
   Storm's build, since the other five already carry the card: Storm's becomes Electric Slide,
   Obstinate, Last Word and Snowdrift (Scout and Squall drop), a legal set under rule 9 (two
   passives, five slots). With it Storm is the strongest First Blood element by a distance: its row
   reads 82.5%, 63.3%, 85.0%, 85.0% and 81.7% (63.3% over Tide) where the defaults gave 35.0%,
   35.0%, 69.2%, 71.7% and 68.3%, Stone over Storm falls from 28.3% to 15.0% and Storm over Frost
   rises to 81.7%: an army that no higher rank can take, moved by turning sliders, wins the first
   exchange. In Full Battle Storm stops being the weakest element by a distance (40.0%, 28.7%,
   30.0%, 60.0% and 61.3% from 26.3%, 0.0%, 8.8%, 17.5% and 70.0%) without becoming a strong one,
   and the advantaged element falls from 72.5% to 64.0%, the closest a Full Battle default has come
   to the 55–60% target with the Crystal in every build (White 49.7%, median 134 plies, 120 of 1,260
   games at the ply cap). The two findings are one: Obstinate decides which side can be attacked, so
   in Full Battle it is the slot Storm has been missing since section 7, and in First Blood it is a
   card the picker should not hand Storm for free. Storm's signature being its passive is what keeps
   the default picker from dealing it (the category spread sees the passive slot filled), so the
   mono-Storm build at the defaults is the no-Obstinate build; a player is not so constrained. This
   goes to B8 with the Tide row: both are Obstinate's price, not Storm's or Tide's.
5. **`ONCE_PER_ABILITY` with the Crystal's new reading.** With the Crystal sparing one silence per
   battle under every scope (DD-122) and Pierce preferred into every build (Scout gives way to it;
   at two charges), `ONCE_PER_ABILITY` reads 57.9% in First Blood and 62.5% in Full Battle with the
   Crystal in every Focused build: inside the 55–60% band in the short format and just above it in
   the long one. Section 8 had the same scope at 47.9% and 44.4% while the Crystal meant never
   (`OFF` for every holder), and at 53.5% and 61.7% only with the Crystal removed from every build;
   the condition finding 4 of that section set for shipping the scope is met, and the scope now
   measures with the item that every build carries. The Full Battle foil pairs read Tide over Ember
   78%, Ember over Grove 68%, Grove over Tide 58%, Frost over Stone 53%, Stone over Storm 80% and
   Storm over Frost 37%: four of six point the right way and the last two are Storm's missing
   Obstinate (finding 4), not the scope. White 47.7% and 51.9%, medians 23 and 111 plies, 55 of 630
   Full Battle games at the ply cap. The default stays `ALL_TRIGGERS` in this item; the data now
   says `ONCE_PER_ABILITY` is the scope closest to target in both formats with the shipped Crystal,
   and B8 should put the switch to the designer with these two tables.
6. **Archetypes under rule 9.** Rule 9 caps the Stalwart king set at Stalwart plus one passive
   (Block Path, at two slots: three of the king's five slots used and nothing else dealable), and
   the Maximum and Flexible builds pay for it. In Full Battle Flexible over Focused falls from 87.5%
   to 52.1% and Maximum against Flexible from 56.3% to 47.9%, both inside the 45–55% band for the
   first time; Maximum over Focused falls from 81.3% to 72.9% and stays out of it. Stalwart kings
   are caught 36 times in 144 games (13 before): the thinner king set is the one that gets hunted
   down. In First Blood Maximum over Focused rises from 58.3% to 65.0% while Flexible over Focused
   falls from 58.3% to 40.8% and Maximum against Flexible from 62.5% to 51.7%: Focused carries the
   two-slot Obstinate in its one five-slot set, Flexible's four-slot per-type sets cannot (the
   spread reaches the passive with one slot left and deals Veil), and Maximum's five-slot sets can,
   so the short format sorts the three by who holds Obstinate and the long one by who holds
   Obstinate and a Stalwart king. White 48.5% and 55.6%, medians 15 and 78 plies, Starter 10–18%
   against the three (as before). Two of the three archetype pairs are now in band in Full Battle;
   the Maximum-Focused gap is the one left, and it is the Stalwart king plus Obstinate on every type
   against Obstinate alone.
7. **Close-out changes.** The review of B5 found Obstinate dead on a queen once kings ignore it
   (nothing it could stop can take a queen), so Obstinate v3 is eligible on pawns, knights, bishops
   and rooks only (DD-116, close-out), and the engine's `hasAbility` now reads false for a card in the
   set but ineligible on the piece's type, so hook-based passives idle on ineligible types exactly as
   triggers do (7.3, R-LOAD-003; test 'R-LOAD-003 an ineligible passive does nothing there'). The
   picker deals Obstinate like an army-wide card (its missing types are ones it could never act on),
   so every Focused and Flexible build above is unchanged by the eligibility and only the Maximum
   queen set changes (Block Path in place of Obstinate); the four completed runs were kept and the
   builds checked identical. The NPC search now knows its own Pierce charges (two, plus
   Overabundance's) from the public usage counters and stops counting on a negation once they are
   spent, so the Trainer plays Pierce v3 as written (DD-120; opponent counters are not read,
   R-FMT-005).

## 12. Three new neutral cards (C6; DD-123 to DD-125)

Plan item C6, the three neutral abilities of the designer brief of 2026-10-09, each measured on its
own in the mirror test (the card in front of the best other cards of its element's Focused build,
against those cards plus the next best one): Cornered (Captured, level 4, one charge; effect-captures
the captor when taken on a rim square), Ricochet (Captures, bishops, rooks and queens, level 8, two
charges; continues one square past the capture) and Overwhelm (Capturing, level 9, two charges;
negates the Captured abilities of a lower-ranked victim). The default picker deals none of them into
a Focused, Maximum or Flexible build at level 25 (the builds of section 11 are unchanged), so the
element and archetype tables stand as measured there.

**The three cards alone, First Blood** — `pnpm sim --suite cards --cards cornered,ricochet,overwhelm --format first_blood --games 36 --nodes 20000`

| Card      | Category  | Level | Score with the card | Games | Median plies | Note          |
| --------- | --------- | ----- | ------------------- | ----- | ------------ | ------------- |
| Overwhelm | CAPTURING | 9     | 63.9%               | 36    | 19           | **above 60%** |
| Cornered  | CAPTURED  | 4     | 50.0%               | 36    | 16           |               |
| Ricochet  | CAPTURES  | 8     | 50.0%               | 36    | 16           |               |

**The three cards alone, Full Battle** — `pnpm sim --suite cards --cards cornered,ricochet,overwhelm --format full --games 24 --nodes 20000`

| Card      | Category  | Level | Score with the card | Games | Median plies | Note                    |
| --------- | --------- | ----- | ------------------- | ----- | ------------ | ----------------------- |
| Overwhelm | CAPTURING | 9     | 64.6%               | 24    | 80           | **above 60%**           |
| Cornered  | CAPTURED  | 4     | 56.3%               | 24    | 104          |                         |
| Ricochet  | CAPTURES  | 8     | 39.6%               | 24    | 80           | below 40% (a liability) |

**What the data says.**

1. **Overwhelm is the one that wins on its own.** 63.9% in First Blood and 64.6% in Full Battle (36
   and 24 games), above the 60% line in both formats; Pierce at two charges reads 69.4% and 54.2%
   (section 11). The rank condition costs it little in the short format, where the first exchange is
   usually a higher rank taking a pawn or a minor piece, and in Full Battle the NPC that knows when
   its negation applies spends its two charges on captures that matter, where Pierce spends them on
   the first two. A rank-conditioned Pierce is still a Pierce for a rook or a queen; the brake it has
   that Pierce lacks is that pawns, knights and bishops get nothing from it against equal rank. It
   goes to B8 as a candidate for one charge or a higher level, measured in the element suites with
   `--prefer overwhelm`.
2. **Cornered is neutral in First Blood and modest in Full Battle.** 50.0% and 56.3%: a Captured card
   that fires on 28 squares, measured against fillers (Snowdrift, Reinforce) that work everywhere. In
   Full Battle the deterrent shows (the NPC that has seen it bite stops taking Cornered pieces on the
   rim: median 104 plies against 80 for the other two cards); in First Blood the first capture is
   rarely on the rim. Its partners (Snowdrift, Snowbound and Frost Heave, which move enemies to the
   edge) are not in the mirror build; B8 measures the pair with `--prefer cornered,snowdrift`.
3. **Ricochet is tempo the NPC cannot plan, and reads as a liability in Full Battle.** 50.0% and
   39.6%: the search does not model the captor's continuation (self-moves after a capture, like Hit
   and Run's return, are outside its capture model), so the carrier never chooses a capture for where
   it lands, and the continuation puts the slider on a square the search did not pick, often beside
   the pieces it just hit, where it is retaken. The number says what Ricochet does for a player who
   ignores it; a deliberate measurement needs the NPC to search the continuation square (a `Played`
   relocation like the Frost Heave push, one line each in `play` and `unplay`), which goes to B8 with
   the card. Every engine brake showed in the module tests: an occupied square, the board's edge, a
   turned Electric Slide path, a burning square and INV-03.
4. **The NPC's new awareness moved the numbers.** An earlier run on the same seeds, made while the
   trigger-condition change to the search (`conditionsHold`, `effectiveProfile`) was still being
   written, read 58.3% / 52.1% for Overwhelm and 52.8% / 39.6% for Cornered (Ricochet 47.2% / 43.8%).
   The difference is an indication, not a measurement, of what knowing when a card applies is worth:
   five to twelve points for the two conditional cards, within noise for Ricochet, which the search
   does not model either way. The same change makes the NPC honour Redo's and Phalanx's conditions,
   which it had read as unconditional until now.
5. **Builds and surprise losses.** The picker deals none of the three into a default build (their
   scores sit below Last Word, Scout, Snowdrift and Obstinate in the category spread), so the element
   and archetype tables of section 11 stand. Surprise losses read 0% in the mirror suite, as in
   section 11 (Scout's Lens on both sides).

## 13. Three new items (C7; DD-126 to DD-128)

Plan item C7, the three items of the designer brief of 2026-10-09: Duelist's Gauntlet (level 10:
When-capturing abilities never silenced, When-captured ones always silenced by the foil), Reliquary
(level 12: the first piece lost returns to its start square at the end of the opponent's next turn,
once) and Herald's Horn (level 7: both item lists revealed at battle start). Items are measured two
ways. The new `--suite items` mirror test puts the item on one side of the element's Focused build
with Scout's Lens left out of both sides to free the slot (same element both sides, so no silence,
which makes the Gauntlet read 50% there by construction). The Gauntlet is then measured in the
element suites, `--items duelists_gauntlet` against the same builds without it and Scout's Lens left
out of both runs: first on the default Focused builds, whose only When-capturing card is Scout; then
with Pierce preferred in every build (`--prefer pierce`, a When-capturing card with a board effect);
and in First Blood also with the Resonance Crystal left out, because the Crystal spares a piece's
first silence and a First Blood game rarely sees a second, so there the Gauntlet alone meets the
first silence.

**The three items alone, First Blood** — `pnpm sim --suite items --items duelists_gauntlet,reliquary,heralds_horn --format first_blood --games 36 --nodes 20000` (Scout's Lens left out of both sides)

| Item               | Level | Score with the item | Games | Median plies | Note          |
| ------------------ | ----- | ------------------- | ----- | ------------ | ------------- |
| Reliquary          | 12    | 61.1%               | 36    | 25           | **above 60%** |
| Duelist's Gauntlet | 10    | 54.2%               | 36    | 26           |               |
| Herald's Horn      | 7     | 54.2%               | 36    | 23           |               |

**The three items alone, Full Battle** — `pnpm sim --suite items --items duelists_gauntlet,reliquary,heralds_horn --format full --games 24 --nodes 20000` (Scout's Lens left out of both sides)

| Item               | Level | Score with the item | Games | Median plies | Note          |
| ------------------ | ----- | ------------------- | ----- | ------------ | ------------- |
| Reliquary          | 12    | 64.6%               | 24    | 114          | **above 60%** |
| Duelist's Gauntlet | 10    | 47.9%               | 24    | 93           |               |
| Herald's Horn      | 7     | 41.7%               | 24    | 114          |               |

**Element matchups, First Blood, the default Focused builds without Scout's Lens (the Gauntlet runs' baseline)** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000 --without scouts_lens`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 55.8% | 29.2%               | 50.8%               | 61.7%               | 50.8%               | 47.5%               |
| tide          | 70.8%               | mirror, white 47.5% | 55.0%               | 68.3%               | 73.3%               | 68.3%               |
| grove         | 49.2%               | 45.0%               | mirror, white 40.0% | 36.7%               | 40.8%               | 56.7%               |
| storm         | 38.3%               | 31.7%               | 63.3%               | mirror, white 40.0% | 83.3%               | 68.3%               |
| stone         | 49.2%               | 26.7%               | 59.2%               | 16.7%               | mirror, white 59.2% | 47.5%               |
| frost         | 52.5%               | 31.7%               | 43.3%               | 31.7%               | 52.5%               | mirror, white 52.5% |

Advantaged element: **50.7%**. White 50.2%, surprise losses 23.8%, median 21 plies. Result reasons: objective 1176, repetition 49, checkmate 32, ply_cap 3.

**Element matchups, Full Battle, the default Focused builds without Scout's Lens (the Gauntlet runs' baseline)** — `pnpm sim --suite elements --format full --games 40 --nodes 20000 --without scouts_lens`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 63.7% | 23.8%               | 62.5%               | 85.0%               | 41.3%               | 48.8%               |
| tide          | 76.3%               | mirror, white 55.0% | 23.8%               | 100.0%              | 53.8%               | 70.0%               |
| grove         | 37.5%               | 76.3%               | mirror, white 47.5% | 92.5%               | 66.3%               | 76.3%               |
| storm         | 15.0%               | 0.0%                | 7.5%                | mirror, white 53.8% | 23.8%               | 63.7%               |
| stone         | 58.8%               | 46.3%               | 33.8%               | 76.3%               | mirror, white 50.0% | 50.0%               |
| frost         | 51.2%               | 30.0%               | 23.8%               | 36.3%               | 50.0%               | mirror, white 51.2% |

Advantaged element: **67.5%**. White 49.9%, surprise losses 4.6%, median 108 plies. Result reasons: repetition 344, checkmate 410, ply_cap 74, fifty_move 10, stalemate 2.

**Element matchups, First Blood, Duelist's Gauntlet on every default Focused build** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000 --items duelists_gauntlet --without scouts_lens`: the same table as the First Blood run above, cell for cell, over 360 games (finding 2).

**Element matchups, Full Battle, Duelist's Gauntlet on every default Focused build (`--items duelists_gauntlet --without scouts_lens`)** — `pnpm sim --suite elements --format full --games 40 --nodes 20000 --items duelists_gauntlet --without scouts_lens`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 63.7% | 21.3%               | 60.0%               | 85.0%               | 41.3%               | 48.8%               |
| tide          | 78.8%               | mirror, white 55.0% | 28.7%               | 100.0%              | 53.8%               | 70.0%               |
| grove         | 40.0%               | 71.3%               | mirror, white 47.5% | 92.5%               | 66.3%               | 76.3%               |
| storm         | 15.0%               | 0.0%                | 7.5%                | mirror, white 53.8% | 26.3%               | 57.5%               |
| stone         | 58.8%               | 46.3%               | 33.8%               | 73.8%               | mirror, white 50.0% | 50.0%               |
| frost         | 51.2%               | 30.0%               | 23.8%               | 42.5%               | 50.0%               | mirror, white 51.2% |

Advantaged element: **65.2%**. White 51.0%, surprise losses 4.6%, median 108 plies. Result reasons: repetition 341, checkmate 411, ply_cap 76, fifty_move 10, stalemate 2.

**Element matchups, Full Battle, Pierce preferred, without Scout's Lens** — `pnpm sim --suite elements --format full --games 30 --nodes 20000 --prefer pierce --without scouts_lens`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 53.3% | 25.0%               | 71.7%               | 83.3%               | 70.0%               | 48.3%               |
| tide          | 75.0%               | mirror, white 38.3% | 30.0%               | 100.0%              | 76.7%               | 58.3%               |
| grove         | 28.3%               | 70.0%               | mirror, white 48.3% | 68.3%               | 41.7%               | 43.3%               |
| storm         | 16.7%               | 0.0%                | 31.7%               | mirror, white 75.0% | 13.3%               | 78.3%               |
| stone         | 30.0%               | 23.3%               | 58.3%               | 86.7%               | mirror, white 50.0% | 50.0%               |
| frost         | 51.7%               | 41.7%               | 56.7%               | 21.7%               | 50.0%               | mirror, white 51.7% |

Advantaged element: **71.9%**. White 50.1%, surprise losses 3.9%, median 104 plies. Result reasons: repetition 236, ply_cap 52, checkmate 333, fifty_move 9.

**Element matchups, Full Battle, Pierce preferred, Duelist's Gauntlet on every build** — `pnpm sim --suite elements --format full --games 30 --nodes 20000 --prefer pierce --without scouts_lens --items duelists_gauntlet`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 53.3% | 25.0%               | 68.3%               | 83.3%               | 70.0%               | 48.3%               |
| tide          | 75.0%               | mirror, white 38.3% | 63.3%               | 100.0%              | 76.7%               | 58.3%               |
| grove         | 31.7%               | 36.7%               | mirror, white 48.3% | 68.3%               | 41.7%               | 43.3%               |
| storm         | 16.7%               | 0.0%                | 31.7%               | mirror, white 75.0% | 11.7%               | 50.0%               |
| stone         | 30.0%               | 23.3%               | 58.3%               | 88.3%               | mirror, white 50.0% | 56.7%               |
| frost         | 51.7%               | 41.7%               | 56.7%               | 50.0%               | 43.3%               | mirror, white 51.7% |

Advantaged element: **60.3%**. White 49.1%, surprise losses 4.0%, median 106 plies. Result reasons: repetition 243, ply_cap 60, checkmate 321, fifty_move 6.

**Element matchups, First Blood, Pierce preferred, without Scout's Lens and the Resonance Crystal** — `pnpm sim --suite elements --format first_blood --games 40 --nodes 20000 --prefer pierce --without scouts_lens,resonance_crystal`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 57.5% | 27.5%               | 58.8%               | 85.0%               | 43.8%               | 48.8%               |
| tide          | 72.5%               | mirror, white 40.0% | 77.5%               | 65.0%               | 68.8%               | 76.3%               |
| grove         | 41.3%               | 22.5%               | mirror, white 40.0% | 47.5%               | 47.5%               | 53.8%               |
| storm         | 15.0%               | 35.0%               | 52.5%               | mirror, white 45.0% | 65.0%               | 70.0%               |
| stone         | 56.3%               | 31.3%               | 52.5%               | 35.0%               | mirror, white 38.8% | 56.3%               |
| frost         | 51.2%               | 23.8%               | 46.3%               | 30.0%               | 43.8%               | mirror, white 47.5% |

Advantaged element: **50.4%**. White 48.0%, surprise losses 33.2%, median 21 plies. Result reasons: objective 779, repetition 32, checkmate 25, ply_cap 3, fifty_move 1.

**Element matchups, First Blood, Pierce preferred, Duelist's Gauntlet on every build, without Scout's Lens and the Resonance Crystal** — `pnpm sim --suite elements --format first_blood --games 40 --nodes 20000 --prefer pierce --without scouts_lens,resonance_crystal --items duelists_gauntlet`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 57.5% | 27.5%               | 58.8%               | 85.0%               | 43.8%               | 48.8%               |
| tide          | 72.5%               | mirror, white 40.0% | 76.3%               | 65.0%               | 68.8%               | 76.3%               |
| grove         | 41.3%               | 23.8%               | mirror, white 40.0% | 47.5%               | 47.5%               | 53.8%               |
| storm         | 15.0%               | 35.0%               | 52.5%               | mirror, white 45.0% | 62.5%               | 55.0%               |
| stone         | 56.3%               | 31.3%               | 52.5%               | 37.5%               | mirror, white 38.8% | 56.3%               |
| frost         | 51.2%               | 23.8%               | 46.3%               | 45.0%               | 43.8%               | mirror, white 47.5% |

Advantaged element: **48.5%**. White 48.9%, surprise losses 32.9%, median 22 plies. Result reasons: objective 780, repetition 31, checkmate 25, ply_cap 3, fifty_move 1.

**What the data says.**

1. **Reliquary is the one that wins on its own.** 61.1% in First Blood and 64.6% in Full Battle (36
   and 24 games), above the 60% line in both formats, measured as the Focused build's Headmaster's
   Ring and Resonance Crystal plus the Reliquary against the Ring and the Crystal alone. A free
   return of the first piece lost is a full piece of material once per battle, and it asks nothing
   of the carrier: the NPC that knows the return is coming (`reliquary` in the search context, the
   first loss discounted at 60% of the piece's value) plays the exchange it would otherwise decline,
   and in Full Battle the returned piece is on the board for the rest of the game. The mirror
   opponent carries no Warden's Stopwatch, so this is the unanswered number; the Stopwatch at level
   18 negates the return (v2, DD-127). It goes to B8 as a candidate for a higher level or a brake
   (the return at the end of the owner's second turn, or pieces up to a knight), measured with
   `--suite items`.
2. **Duelist's Gauntlet changes nothing in First Blood on the default builds, by construction; its
   measurement is Full Battle and the first silence without the Crystal.** In the mirror it reads
   54.2% and 47.9%, noise around the 50% the test gives it (same element both sides, so no silence
   to trade). On the default Focused builds, the First Blood element run with the Gauntlet on every
   build is its baseline cell for cell over 360 games. A probe game log shows why: a First Blood
   game has one exchange, and the Resonance Crystal in every Focused build spares that piece's
   triggers in that capture; with the Gauntlet, the Gauntlet spares the When-capturing trigger and
   the Crystal the When-captures one next to it, the same outcome with a different item paying. The
   default builds' only When-capturing card is Scout, a reveal, besides. In Full Battle, where the
   Crystal is spent before the game is decided, the advantaged element reads 65.2% with the Gauntlet
   against 67.5% without (40 games per pairing). With Pierce preferred in every build (a
   When-capturing card with a board effect) Full Battle reads 60.3% with the Gauntlet against 71.9%
   without (30 games). What the Gauntlet does under the shipped scope is take the element wheel out
   of the pairs where the wheel silenced the carrier's Pierce: grove over tide falls from 70.0% to
   36.7% and storm over frost from 78.3% to 50.0%, the other pairs keep their scores, and the
   aggregate lands at 60.3%, the closest Full Battle has come to the 55–60% band in any
   configuration (section 11's best was 62.5% under `ONCE_PER_ABILITY` with the same Pierce). It
   gets there by neutralising the wheel rather than by balancing it: a one-slot level-10 item whose
   cost half (When-captured cards always silenced by the foil) the element rule already charges
   under the shipped scope, so it is pure upside for anyone who carries When-capturing cards. In
   First Blood with the Crystal left out, where the Gauntlet alone meets the first silence, the
   advantaged element reads 48.5% with it against 50.4% without, and the one pair that moves is
   again a Pierce pair, storm over frost from 70.0% to 55.0%: the format's one exchange has little
   wheel left to neutralise (First Blood reads 51.2% at the defaults in section 11), so the Gauntlet
   is a Full Battle item. It goes to B8 with three options: a higher level (18 or above, so Focused
   builds meet it late), a real price under every scope (the wearer's When-captured cards silenced
   by every opponent, not only the foil), or keeping it as the `ONCE_PER_ABILITY` item, where its
   cost exists.
3. **Herald's Horn reads 54.2% and 41.7%: information both sides already have.** In a mirror the two
   item lists differ by the Horn alone, so revealing them is worth nothing by construction, and the
   two numbers are noise at 36 and 24 games (41.7% is 10 of 24). What the Horn buys is the NPC's
   belief state knowing the opponent's items from move one (`beliefState` counts only revealed
   items: a Stopwatch that will negate a revive, a Crystal that spares a silence, a Mask's element),
   which only shows where the lists differ; B8 measures it in the archetype suite (Focused against
   Maximum) with `--items heralds_horn`.
4. **Without Scout's Lens, surprise losses are back.** 32.4% of decided First Blood battles in the
   mirror suite and 23.8% in the element suite without the Lens, against 0.0% with it in sections 11
   and 12: the Lens's whole-set reveal is what hides them, and in First Blood the first capture
   decides the battle before any other reveal. In Full Battle they read 0.0% in the mirror suite and
   4.6% in the element suite, under the 15% target (a set is revealed long before the decision). The
   advantaged element without the Lens reads 50.7% and 67.5% against 51.2% and 72.5% with it
   (section 11): whole-set knowledge is worth about five points to the favoured side in Full Battle,
   which plays the long game with the opponent's cards in view, and nothing in First Blood, which
   ends before the knowledge is used.
5. **Builds.** The Focused build's items are a fixed list (Headmaster's Ring, Resonance Crystal,
   Scout's Lens), so the three items enter a build only through `--items` and the element and
   archetype tables of section 11 stand. `pnpm test:fuzz` passes (500 games, 44,548 plies, replays
   identical, 500 games projection-scanned for players and spectators, no crash) with the three
   items in the pool.

## 14. Final balance report (B8)

Plan item B8, the last of the designer's list of 2026-10-09: the finished catalogue (36 abilities,
16 items, six elements, the rulings of sections 10 and 11, the cards of section 12 and the items of
section 13) measured against the 17.2 targets at the shipped defaults, the follow-ups sections 11 to
13 asked for, a 3,000-game fuzz under each candidate silence scope, and the decisions this leaves
with the designer. Method as in section 1: Trainer NPCs at 20,000 nodes, level 25, each side
searching its own projection; the element suite plays the six mono-element Focused builds against
each other, the archetype suite the four build archetypes of 7.3 across element pairs, and the
mirror suites each card and each item against its own absence. The per-card and per-item tables are
the "pick rate" proxy of 17.2: a card that wins more than 60% of mirror games on its own is one
every top loadout would carry. Nothing COMMITTED was touched in this item; the catalogue is as the
plan left it, and every number below is reproducible with the command above its table or beside its
number (`reports/sim/`, tags `b8`, `b8s` for the same-seed baselines and `b8n` for the noise check).

### 14.0 The 17.2 scorecard on the finished catalogue

| 17.2 metric                                                                          | Target                                     | First Blood                                                              | Full Battle                                   | Met                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------- | ---------------------- |
| Advantaged element win rate                                                          | 55–60%                                     | 51.2%                                                                    | 72.5%                                         | no / no                |
| Maximum, Flexible, Focused against each other                                        | each 45–55%                                | Max–Flex 51.7%, Max–Foc 65.0%, Flex–Foc 40.8%                            | Max–Flex 62.5%, Max–Foc 70.8%, Flex–Foc 52.1% | no / no                |
| White win rate (element suite)                                                       | ≤ 56%                                      | 48.1%                                                                    | 50.7%                                         | yes / yes              |
| Surprise losses (element suite; archetype suite in brackets, which sets the verdict) | < 15%                                      | 0.0% (30.4%)                                                             | 0.0% (13.2%)                                  | no / yes               |
| Any single ability's pick rate (proxy: cards above 60% alone)                        | < 40%                                      | 5 of 36 cards                                                            | 13 of 36 cards                                | no / no                |
| Median length (element suite, plies; live clocks set the minutes)                    | First Blood 2–5 min, Full Battle 10–25 min | 23 plies                                                                 | 110 plies                                     | finding 7, decision 12 |
| New player first win                                                                 | < 30 minutes after sign-up                 | not a simulator metric: the first-win e2e covers the path (PROGRESS, M5) |                                               | —                      |

### 14.1 The finished catalogue at the shipped defaults

**Element matchups, First Blood, the shipped defaults** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 41.7% | 35.8%               | 49.2%               | 65.0%               | 45.8%               | 45.0%               |
| tide          | 64.2%               | mirror, white 33.3% | 53.3%               | 65.0%               | 81.7%               | 76.7%               |
| grove         | 50.8%               | 46.7%               | mirror, white 52.5% | 30.8%               | 66.7%               | 60.8%               |
| storm         | 35.0%               | 35.0%               | 69.2%               | mirror, white 48.3% | 71.7%               | 68.3%               |
| stone         | 54.2%               | 18.3%               | 33.3%               | 28.3%               | mirror, white 55.0% | 49.2%               |
| frost         | 55.0%               | 23.3%               | 39.2%               | 31.7%               | 50.8%               | mirror, white 52.5% |

Advantaged element: **51.2%**. White 48.1%, surprise losses 0.0%, median 23 plies. Result reasons: objective 1172, repetition 50, checkmate 32, ply_cap 6.

**Element matchups, Full Battle, the shipped defaults** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 45.0% | 22.5%               | 70.0%               | 73.8%               | 41.3%               | 53.8%               |
| tide          | 77.5%               | mirror, white 51.2% | 20.0%               | 100.0%              | 56.3%               | 65.0%               |
| grove         | 30.0%               | 80.0%               | mirror, white 48.8% | 91.3%               | 63.7%               | 65.0%               |
| storm         | 26.3%               | 0.0%                | 8.8%                | mirror, white 53.8% | 17.5%               | 70.0%               |
| stone         | 58.8%               | 43.8%               | 36.3%               | 82.5%               | mirror, white 53.8% | 45.0%               |
| frost         | 46.3%               | 35.0%               | 35.0%               | 30.0%               | 55.0%               | mirror, white 51.2% |

Advantaged element: **72.5%**. White 50.7%, surprise losses 0.0%, median 110 plies. Result reasons: checkmate 399, repetition 328, ply_cap 100, stalemate 2, fifty_move 11.

**Build archetypes, First Blood, the shipped defaults** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 51.7%    | 65.0%   | 66.7%   |
| flexible      | 48.3%   | —        | 40.8%   | 45.0%   |
| focused       | 35.0%   | 59.2%    | —       | 81.7%   |
| starter       | 33.3%   | 55.0%    | 18.3%   | —       |

White 48.5%, surprise losses 30.4%, median 15 plies. Result reasons: objective 348, stalwart_captured 6, repetition 5, checkmate 1.

**Build archetypes, Full Battle, the shipped defaults** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 62.5%    | 70.8%   | 95.8%   |
| flexible      | 37.5%   | —        | 52.1%   | 87.5%   |
| focused       | 29.2%   | 47.9%    | —       | 89.6%   |
| starter       | 4.2%    | 12.5%    | 10.4%   | —       |

White 54.2%, surprise losses 13.2%, median 78 plies. Result reasons: stalwart_captured 32, repetition 27, checkmate 82, stalemate 1, ply_cap 2.

**Every card alone, First Blood** — `pnpm sim --suite cards --format first_blood --games 36 --nodes 20000`

| Card                | Category  | Level | Score with the card | Games | Median plies | Note                    |
| ------------------- | --------- | ----- | ------------------- | ----- | ------------ | ----------------------- |
| Electric Slide      | PASSIVE   | 3     | 83.3%               | 36    | 13           | **above 60%**           |
| Obstinate           | PASSIVE   | 9     | 75.0%               | 36    | 16           | **above 60%**           |
| Stonewall           | CAPTURED  | 3     | 68.1%               | 36    | 32           | **above 60%**           |
| Squall              | CAPTURED  | 1     | 62.5%               | 36    | 20           | **above 60%**           |
| Redo                | CAPTURED  | 15    | 61.1%               | 36    | 19           | **above 60%**           |
| Stalwart            | PASSIVE   | 16    | 58.3%               | 36    | 9            |                         |
| Backdraft           | CAPTURED  | 4     | 55.6%               | 36    | 17           |                         |
| Rebuild             | CAPTURES  | 17    | 55.6%               | 36    | 21           |                         |
| Snowbound           | CAPTURING | 14    | 55.6%               | 36    | 19           |                         |
| Antidote            | CAPTURING | 5     | 54.2%               | 36    | 17           |                         |
| Overwhelm           | CAPTURING | 9     | 54.2%               | 36    | 22           |                         |
| Permafrost          | CAPTURED  | 20    | 54.2%               | 36    | 18           |                         |
| Buttress            | CAPTURING | 2     | 52.8%               | 36    | 15           |                         |
| Ricochet            | CAPTURES  | 8     | 51.4%               | 36    | 18           |                         |
| Slipstream          | CAPTURES  | 12    | 51.4%               | 36    | 19           |                         |
| Snowdrift           | CAPTURES  | 9     | 51.4%               | 36    | 17           |                         |
| Pierce              | CAPTURING | 3     | 50.0%               | 36    | 15           |                         |
| Rebirth             | CAPTURED  | 14    | 50.0%               | 36    | 20           |                         |
| Block Path          | PASSIVE   | 12    | 48.6%               | 36    | 20           |                         |
| Cleave              | CAPTURES  | 3     | 48.6%               | 36    | 25           |                         |
| Poisoned Meat       | CAPTURED  | 2     | 48.6%               | 36    | 29           |                         |
| Phalanx             | CAPTURING | 10    | 47.2%               | 36    | 20           |                         |
| Riposte             | CAPTURED  | 12    | 47.2%               | 36    | 19           |                         |
| Cornered            | CAPTURED  | 4     | 44.4%               | 36    | 18           |                         |
| Hit and Run         | CAPTURES  | 1     | 44.4%               | 36    | 21           |                         |
| Momentum            | CAPTURES  | 8     | 44.4%               | 36    | 19           |                         |
| Last Word           | CAPTURED  | 1     | 43.1%               | 36    | 22           |                         |
| Pawn Storm          | CAPTURES  | 7     | 43.1%               | 36    | 17           |                         |
| Reinforce           | CAPTURES  | 10    | 43.1%               | 36    | 22           |                         |
| Schrödinger's Joker | CAPTURES  | 20    | 43.1%               | 36    | 20           |                         |
| Afterimage          | CAPTURES  | 5     | 41.7%               | 36    | 14           |                         |
| Necromancer         | CAPTURES  | 11    | 40.3%               | 36    | 24           |                         |
| Scout               | CAPTURING | 1     | 38.9%               | 36    | 30           | below 40% (a liability) |
| Veil                | PASSIVE   | 18    | 38.9%               | 36    | 16           | below 40% (a liability) |
| Quantum Kill        | CAPTURES  | 13    | 34.7%               | 36    | 14           | below 40% (a liability) |
| Frost Heave         | CAPTURED  | 3     | 31.9%               | 36    | 33           | below 40% (a liability) |

5 of 36 cards above 60%: Electric Slide, Obstinate, Stonewall, Squall, Redo. White 53.9%, surprise losses 0.0%, median 18 plies.

**Every card alone, Full Battle** — `pnpm sim --suite cards --format full --games 24 --nodes 20000`

| Card                | Category  | Level | Score with the card | Games | Median plies | Note                    |
| ------------------- | --------- | ----- | ------------------- | ----- | ------------ | ----------------------- |
| Poisoned Meat       | CAPTURED  | 2     | 85.4%               | 24    | 110          | **above 60%**           |
| Obstinate           | PASSIVE   | 9     | 81.3%               | 24    | 88           | **above 60%**           |
| Rebirth             | CAPTURED  | 14    | 81.3%               | 24    | 89           | **above 60%**           |
| Riposte             | CAPTURED  | 12    | 81.3%               | 24    | 77           | **above 60%**           |
| Cleave              | CAPTURES  | 3     | 77.1%               | 24    | 109          | **above 60%**           |
| Block Path          | PASSIVE   | 12    | 68.8%               | 24    | 91           | **above 60%**           |
| Stonewall           | CAPTURED  | 3     | 66.7%               | 24    | 121          | **above 60%**           |
| Backdraft           | CAPTURED  | 4     | 64.6%               | 24    | 86           | **above 60%**           |
| Pierce              | CAPTURING | 3     | 64.6%               | 24    | 80           | **above 60%**           |
| Afterimage          | CAPTURES  | 5     | 62.5%               | 24    | 115          | **above 60%**           |
| Stalwart            | PASSIVE   | 16    | 62.5%               | 24    | 70           | **above 60%**           |
| Hit and Run         | CAPTURES  | 1     | 60.4%               | 24    | 114          | **above 60%**           |
| Squall              | CAPTURED  | 1     | 60.4%               | 24    | 86           | **above 60%**           |
| Cornered            | CAPTURED  | 4     | 58.3%               | 24    | 88           |                         |
| Overwhelm           | CAPTURING | 9     | 58.3%               | 24    | 100          |                         |
| Phalanx             | CAPTURING | 10    | 58.3%               | 24    | 86           |                         |
| Antidote            | CAPTURING | 5     | 56.3%               | 24    | 72           |                         |
| Necromancer         | CAPTURES  | 11    | 56.3%               | 24    | 97           |                         |
| Reinforce           | CAPTURES  | 10    | 54.2%               | 24    | 64           |                         |
| Ricochet            | CAPTURES  | 8     | 54.2%               | 24    | 92           |                         |
| Snowdrift           | CAPTURES  | 9     | 54.2%               | 24    | 81           |                         |
| Pawn Storm          | CAPTURES  | 7     | 52.1%               | 24    | 113          |                         |
| Buttress            | CAPTURING | 2     | 50.0%               | 24    | 81           |                         |
| Frost Heave         | CAPTURED  | 3     | 50.0%               | 24    | 115          |                         |
| Last Word           | CAPTURED  | 1     | 50.0%               | 24    | 125          |                         |
| Momentum            | CAPTURES  | 8     | 50.0%               | 24    | 77           |                         |
| Quantum Kill        | CAPTURES  | 13    | 47.9%               | 24    | 103          |                         |
| Scout               | CAPTURING | 1     | 47.9%               | 24    | 111          |                         |
| Snowbound           | CAPTURING | 14    | 47.9%               | 24    | 108          |                         |
| Electric Slide      | PASSIVE   | 3     | 45.8%               | 24    | 76           |                         |
| Rebuild             | CAPTURES  | 17    | 45.8%               | 24    | 81           |                         |
| Slipstream          | CAPTURES  | 12    | 45.8%               | 24    | 65           |                         |
| Permafrost          | CAPTURED  | 20    | 43.8%               | 24    | 102          |                         |
| Schrödinger's Joker | CAPTURES  | 20    | 43.8%               | 24    | 107          |                         |
| Veil                | PASSIVE   | 18    | 41.7%               | 24    | 96           |                         |
| Redo                | CAPTURED  | 15    | 37.5%               | 24    | 105          | below 40% (a liability) |

13 of 36 cards above 60%: Poisoned Meat, Obstinate, Rebirth, Riposte, Cleave, Block Path, Stonewall, Backdraft, Pierce, Afterimage, Stalwart, Hit and Run, Squall. White 53.9%, surprise losses 0.0%, median 91 plies.

**Every item the mirror can hold, First Blood** — `pnpm sim --suite items --items duelists_gauntlet,heralds_horn,mainspring,mooring_chain,multitaskers_schedule,reliquary,resonance_crystal,scouts_lens,wardens_stopwatch --format first_blood --games 36 --nodes 20000` (the seven items that need an element choice, a second element or a capacity the Focused build cannot give up are not mirror-testable)

| Item                   | Level | Score with the item | Games | Median plies | Note          |
| ---------------------- | ----- | ------------------- | ----- | ------------ | ------------- |
| Herald's Horn          | 7     | 72.2%               | 36    | 22           | **above 60%** |
| Mooring Chain          | 8     | 63.9%               | 36    | 21           | **above 60%** |
| Warden's Stopwatch     | 18    | 58.3%               | 36    | 20           |               |
| Scout's Lens           | 3     | 55.6%               | 36    | 22           |               |
| Duelist's Gauntlet     | 10    | 54.2%               | 36    | 26           |               |
| Mainspring             | 11    | 54.2%               | 36    | 23           |               |
| Reliquary              | 12    | 51.4%               | 36    | 20           |               |
| Resonance Crystal      | 6     | 48.6%               | 36    | 25           |               |
| Multitasker's Schedule | 10    | 47.2%               | 36    | 22           |               |

2 of 9 items above 60%: Herald's Horn, Mooring Chain. White 48.8%, surprise losses 27.3%, median 22 plies.

**Every item the mirror can hold, Full Battle** — `pnpm sim --suite items --items duelists_gauntlet,heralds_horn,mainspring,mooring_chain,multitaskers_schedule,reliquary,resonance_crystal,scouts_lens,wardens_stopwatch --format full --games 24 --nodes 20000` (the seven items that need an element choice, a second element or a capacity the Focused build cannot give up are not mirror-testable)

| Item                   | Level | Score with the item | Games | Median plies | Note          |
| ---------------------- | ----- | ------------------- | ----- | ------------ | ------------- |
| Reliquary              | 12    | 62.5%               | 24    | 110          | **above 60%** |
| Multitasker's Schedule | 10    | 60.4%               | 24    | 125          | **above 60%** |
| Herald's Horn          | 7     | 52.1%               | 24    | 130          |               |
| Duelist's Gauntlet     | 10    | 47.9%               | 24    | 93           |               |
| Mooring Chain          | 8     | 47.9%               | 24    | 115          |               |
| Warden's Stopwatch     | 18    | 45.8%               | 24    | 138          |               |
| Resonance Crystal      | 6     | 43.8%               | 24    | 122          |               |
| Mainspring             | 11    | 41.7%               | 24    | 114          |               |
| Scout's Lens           | 3     | 41.7%               | 24    | 134          |               |

2 of 9 items above 60%: Reliquary, Multitasker's Schedule. White 49.3%, surprise losses 1.3%, median 118 plies.

### 14.2 The follow-ups sections 11 to 13 asked for

Seeds are dealt per game, so a 40-game run plays different games from a 60-game run in every pairing
but the first; the follow-ups (40 and 30 games per pairing) are read against the shipped defaults on
their own seeds, below, not against 14.1.

**Element matchups, First Blood, the shipped defaults on the follow-ups' seeds** — `pnpm sim --suite elements --format first_blood --games 40 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 43.8% | 31.3%               | 67.5%               | 80.0%               | 41.3%               | 45.0%               |
| tide          | 68.8%               | mirror, white 51.2% | 67.5%               | 67.5%               | 71.3%               | 78.8%               |
| grove         | 32.5%               | 32.5%               | mirror, white 65.0% | 35.0%               | 55.0%               | 51.2%               |
| storm         | 20.0%               | 32.5%               | 65.0%               | mirror, white 50.0% | 52.5%               | 65.0%               |
| stone         | 58.8%               | 28.7%               | 45.0%               | 47.5%               | mirror, white 47.5% | 48.8%               |
| frost         | 55.0%               | 21.3%               | 48.8%               | 35.0%               | 51.2%               | mirror, white 43.8% |

Advantaged element: **55.4%**. White 50.4%, surprise losses 0.0%, median 23 plies. Result reasons: objective 765, repetition 44, checkmate 26, ply_cap 4, fifty_move 1.

**Element matchups, Full Battle, the shipped defaults on the follow-ups' seeds** — `pnpm sim --suite elements --format full --games 30 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 45.0% | 25.0%               | 70.0%               | 76.7%               | 45.0%               | 41.7%               |
| tide          | 75.0%               | mirror, white 45.0% | 13.3%               | 100.0%              | 45.0%               | 56.7%               |
| grove         | 30.0%               | 86.7%               | mirror, white 50.0% | 91.7%               | 70.0%               | 70.0%               |
| storm         | 23.3%               | 0.0%                | 8.3%                | mirror, white 50.0% | 21.7%               | 76.7%               |
| stone         | 55.0%               | 55.0%               | 30.0%               | 78.3%               | mirror, white 56.7% | 50.0%               |
| frost         | 58.3%               | 43.3%               | 30.0%               | 23.3%               | 50.0%               | mirror, white 46.7% |

Advantaged element: **72.8%**. White 51.6%, surprise losses 0.0%, median 116 plies. Result reasons: ply_cap 67, checkmate 314, repetition 235, fifty_move 11, stalemate 3.

**Element matchups, First Blood, Overwhelm in every Focused build (`--prefer overwhelm`)** — `pnpm sim --suite elements --format first_blood --games 40 --nodes 20000 --prefer overwhelm`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 43.8% | 31.3%               | 67.5%               | 80.0%               | 41.3%               | 45.0%               |
| tide          | 68.8%               | mirror, white 51.2% | 67.5%               | 62.5%               | 71.3%               | 78.8%               |
| grove         | 32.5%               | 32.5%               | mirror, white 65.0% | 37.5%               | 55.0%               | 51.2%               |
| storm         | 20.0%               | 37.5%               | 62.5%               | mirror, white 52.5% | 57.5%               | 67.5%               |
| stone         | 58.8%               | 28.7%               | 45.0%               | 42.5%               | mirror, white 47.5% | 51.2%               |
| frost         | 55.0%               | 21.3%               | 48.8%               | 32.5%               | 48.8%               | mirror, white 43.8% |

Advantaged element: **54.6%**. White 49.9%, surprise losses 0.0%, median 23 plies. Result reasons: objective 766, repetition 44, checkmate 25, ply_cap 4, fifty_move 1.

**Element matchups, Full Battle, Overwhelm in every Focused build (`--prefer overwhelm`)** — `pnpm sim --suite elements --format full --games 30 --nodes 20000 --prefer overwhelm`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 46.7% | 23.3%               | 60.0%               | 91.7%               | 48.3%               | 50.0%               |
| tide          | 76.7%               | mirror, white 43.3% | 20.0%               | 100.0%              | 48.3%               | 66.7%               |
| grove         | 40.0%               | 80.0%               | mirror, white 50.0% | 90.0%               | 58.3%               | 61.7%               |
| storm         | 8.3%                | 0.0%                | 10.0%               | mirror, white 60.0% | 5.0%                | 66.7%               |
| stone         | 51.7%               | 51.7%               | 41.7%               | 95.0%               | mirror, white 56.7% | 50.0%               |
| frost         | 50.0%               | 33.3%               | 38.3%               | 33.3%               | 50.0%               | mirror, white 51.7% |

Advantaged element: **71.4%**. White 50.1%, surprise losses 0.0%, median 110 plies. Result reasons: repetition 251, checkmate 307, ply_cap 55, fifty_move 16, stalemate 1.

**Element matchups, First Blood, Cornered and Snowdrift in every Focused build (`--prefer cornered,snowdrift`)** — `pnpm sim --suite elements --format first_blood --games 40 --nodes 20000 --prefer cornered,snowdrift`

| Row vs column | ember               | tide               | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------ | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 61.3% | 82.5%              | 30.0%               | 11.3%               | 30.0%               | 41.3%               |
| tide          | 17.5%               | mirror, white 5.0% | 67.5%               | 23.8%               | 63.7%               | 80.0%               |
| grove         | 70.0%               | 32.5%              | mirror, white 36.3% | 27.5%               | 45.0%               | 45.0%               |
| storm         | 88.8%               | 76.3%              | 72.5%               | mirror, white 45.0% | 65.0%               | 70.0%               |
| stone         | 70.0%               | 36.3%              | 55.0%               | 35.0%               | mirror, white 43.8% | 28.7%               |
| frost         | 58.8%               | 20.0%              | 55.0%               | 30.0%               | 71.3%               | mirror, white 46.3% |

Advantaged element: **42.7%**. White 43.0%, surprise losses 0.0%, median 18 plies. Result reasons: objective 790, checkmate 23, repetition 26, ply_cap 1.

**Element matchups, Full Battle, Cornered and Snowdrift in every Focused build (`--prefer cornered,snowdrift`)** — `pnpm sim --suite elements --format full --games 30 --nodes 20000 --prefer cornered,snowdrift`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 48.3% | 16.7%               | 65.0%               | 48.3%               | 18.3%               | 26.7%               |
| tide          | 83.3%               | mirror, white 61.7% | 3.3%                | 76.7%               | 21.7%               | 33.3%               |
| grove         | 35.0%               | 96.7%               | mirror, white 55.0% | 71.7%               | 58.3%               | 65.0%               |
| storm         | 51.7%               | 23.3%               | 28.3%               | mirror, white 58.3% | 36.7%               | 40.0%               |
| stone         | 81.7%               | 78.3%               | 41.7%               | 63.3%               | mirror, white 50.0% | 25.0%               |
| frost         | 73.3%               | 66.7%               | 35.0%               | 60.0%               | 75.0%               | mirror, white 48.3% |

Advantaged element: **70.6%**. White 51.5%, surprise losses 0.0%, median 99 plies. Result reasons: repetition 312, ply_cap 8, checkmate 305, fifty_move 5.

**Build archetypes, First Blood, the Focused build without Scout's Lens (the Horn runs' baseline)** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000 --without scouts_lens`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 51.7%    | 70.8%   | 66.7%   |
| flexible      | 48.3%   | —        | 45.0%   | 45.0%   |
| focused       | 29.2%   | 55.0%    | —       | 70.0%   |
| starter       | 33.3%   | 55.0%    | 30.0%   | —       |

White 46.5%, surprise losses 33.6%, median 14 plies. Result reasons: objective 350, stalwart_captured 5, repetition 3, checkmate 2.

**Build archetypes, First Blood, Herald's Horn on the Focused build in the Lens's slot (`--items heralds_horn --without scouts_lens`)** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000 --without scouts_lens --items heralds_horn`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 51.7%    | 70.8%   | 66.7%   |
| flexible      | 48.3%   | —        | 45.0%   | 45.0%   |
| focused       | 29.2%   | 55.0%    | —       | 70.0%   |
| starter       | 33.3%   | 55.0%    | 30.0%   | —       |

White 46.5%, surprise losses 33.6%, median 14 plies. Result reasons: objective 350, stalwart_captured 5, repetition 3, checkmate 2.

**Build archetypes, Full Battle, the Focused build without Scout's Lens (the Horn runs' baseline)** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000 --without scouts_lens`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 62.5%    | 66.7%   | 95.8%   |
| flexible      | 37.5%   | —        | 39.6%   | 87.5%   |
| focused       | 33.3%   | 60.4%    | —       | 79.2%   |
| starter       | 4.2%    | 12.5%    | 20.8%   | —       |

White 53.1%, surprise losses 15.0%, median 78 plies. Result reasons: stalwart_captured 37, repetition 25, checkmate 76, ply_cap 5, stalemate 1.

**Build archetypes, Full Battle, Herald's Horn on the Focused build in the Lens's slot (`--items heralds_horn --without scouts_lens`)** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000 --without scouts_lens --items heralds_horn`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 62.5%    | 66.7%   | 95.8%   |
| flexible      | 37.5%   | —        | 43.8%   | 87.5%   |
| focused       | 33.3%   | 56.3%    | —       | 79.2%   |
| starter       | 4.2%    | 12.5%    | 20.8%   | —       |

White 52.4%, surprise losses 15.0%, median 78 plies. Result reasons: stalwart_captured 36, repetition 25, checkmate 77, ply_cap 5, stalemate 1.

**Element matchups, First Blood, `ONCE_PER_ABILITY` with the shipped Crystal** — `pnpm sim --suite elements --format first_blood --games 40 --nodes 20000 --silence ONCE_PER_ABILITY`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 43.8% | 31.3%               | 66.3%               | 80.0%               | 41.3%               | 45.0%               |
| tide          | 68.8%               | mirror, white 51.2% | 67.5%               | 67.5%               | 71.3%               | 78.8%               |
| grove         | 33.8%               | 32.5%               | mirror, white 65.0% | 35.0%               | 55.0%               | 51.2%               |
| storm         | 20.0%               | 32.5%               | 65.0%               | mirror, white 50.0% | 55.0%               | 65.0%               |
| stone         | 58.8%               | 28.7%               | 45.0%               | 45.0%               | mirror, white 47.5% | 48.8%               |
| frost         | 55.0%               | 21.3%               | 48.8%               | 35.0%               | 51.2%               | mirror, white 43.8% |

Advantaged element: **54.8%**. White 50.5%, surprise losses 0.0%, median 23 plies. Result reasons: objective 764, repetition 45, checkmate 26, ply_cap 4, fifty_move 1.

**Element matchups, Full Battle, `ONCE_PER_ABILITY` with the shipped Crystal** — `pnpm sim --suite elements --format full --games 30 --nodes 20000 --silence ONCE_PER_ABILITY`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 45.0% | 30.0%               | 45.0%               | 76.7%               | 45.0%               | 41.7%               |
| tide          | 70.0%               | mirror, white 45.0% | 13.3%               | 100.0%              | 45.0%               | 56.7%               |
| grove         | 55.0%               | 86.7%               | mirror, white 50.0% | 91.7%               | 70.0%               | 70.0%               |
| storm         | 23.3%               | 0.0%                | 8.3%                | mirror, white 50.0% | 38.3%               | 48.3%               |
| stone         | 55.0%               | 55.0%               | 30.0%               | 61.7%               | mirror, white 56.7% | 43.3%               |
| frost         | 58.3%               | 43.3%               | 30.0%               | 51.7%               | 56.7%               | mirror, white 46.7% |

Advantaged element: **61.4%**. White 51.3%, surprise losses 0.0%, median 121 plies. Result reasons: ply_cap 66, checkmate 293, repetition 257, fifty_move 11, stalemate 3.

**What the data says.**

1. **The defaults of section 11 are the finished catalogue's defaults.** The element suites on the
   finished catalogue reproduce section 11's tables of the shipped defaults cell for cell in both
   formats (51.2% and 72.5% advantaged element, White 48.1% and 50.7%, surprise losses 0.0%, medians
   23 and 110 plies, the same result reasons): the picker deals none of C6's cards or C7's items
   into a default Focused build, the NPC's new condition and item awareness changes no outcome in
   these builds, and the simulator is deterministic (INV-04). Everything that changed since section
   5's baseline is in sections 7 to 13, each measured when it landed; the defaults are B5's.
2. **Elements.** First Blood sits at 51.2%, under the 55–60% band: the short format has shown little
   of the wheel in every run of this document (the shipped defaults read 47–55% from section 2 to
   here, and no configuration has taken First Blood past 58%), and the Tide row (53–82%) and Storm
   over Grove, Stone and Frost (68–72%) carry the aggregate. Full Battle at 72.5% is twelve and a
   half points over the band, with Tide over Storm 100%, Grove over Storm 91% and Stone over Storm
   83%: Storm's Full Battle row (0–26% against four elements) is where the excess lives, and section
   11 (finding 4) traced it to Obstinate, which the picker cannot hand Storm beside its passive
   signature. The scope switch of decision 1 brings the Full Battle aggregate from 72.8% to 61.4% on
   the follow-ups' seeds (14.2) and Obstinate's rework (decision 2) is the other lever; neither
   touches a COMMITTED rule.
3. **Archetypes.** First Blood reproduces section 11 (Maximum–Flexible 51.7%, Maximum–Focused 65.0%,
   Flexible–Focused 40.8%; White 48.5%, surprise losses 30.4%, median 15 plies). Full Battle does
   not quite: Maximum–Flexible reads 62.5% (section 11: 47.9%), Maximum–Focused 70.8% (72.9%) and
   Flexible–Focused 52.1% (52.1%), White 54.2%, surprise losses 13.2%, median 78 plies, 32 Stalwart
   kings caught in 144 games (36). Two things differ from section 11's runs, which were kept from
   before the B5 close-out (section 11, finding 7): Obstinate v3's eligibility has since put Block
   Path in place of Obstinate in the Maximum queen set, and the NPC honours trigger conditions since
   C6 (section 12, finding 4), where Redo, in Storm's per-type sets of the two Maximum builds that
   pair Storm (with Grove and with Stone), is the one condition-bearing card these builds carry;
   none of the new cards or items is dealt into an archetype build, and no archetype build holds
   Phalanx, the Gauntlet or the Reliquary. A swing of three and a half games in 24 is one the
   suite's noise can produce (one standard deviation at 24 games is ten points), so the reading is
   section 11's with one pair moved: Flexible–Focused in band, Maximum over Focused out by fifteen
   to twenty points (section 11 read it as the Stalwart king plus Obstinate on every type), and
   Maximum–Flexible now 7.5 points over the band where section 11 had it inside. Section 12 wrote
   that section 11's archetype tables stood after C6; the Full Battle table did not, since the
   search change landed with C6. Starter loses 88–96% of its Full Battle games against the three, as
   a level-5 build should.
4. **Cards alone.** The whole catalogue in one run, 36 and 24 games a card, each card's games on its
   own seeds (the six cards before Cornered in registry order, Afterimage to Cleave, kept section
   5's seeds; every later card and every card of the targeted runs of sections 7 to 12 drew others,
   and section 5 used the older mirror; at 36 games one standard deviation of a mirror score is
   eight points, at 24 games ten, so a card is read by which side of the line it sits on in both
   formats, not by a point). In First Blood five cards are above 60%: Electric Slide 83.3% (section
   5: 100.0%, before DD-106 and DD-111; section 10.1 read the DD-111 rule at 82.5% over 300 games),
   Obstinate 75.0% (88.9%, before its second slot), Stonewall 68.1% (50.0%), Squall 62.5% (69.4%)
   and Redo 61.1% (61.1%); Stalwart reads 58.3% (69.4%), and four cards read as liabilities under
   40%: Scout 38.9%, Veil 38.9%, Quantum Kill 34.7% and Frost Heave 31.9%. Section 5 had eleven
   cards above the line in First Blood; the changes of sections 7 to 11 (the Electric Slide rules of
   DD-106 and DD-111, Obstinate and Block Path at two slots, Pierce's second charge) and the mirror
   that now measures a card against the fillers its slots displace came between the two tables, and
   the Captures cards that lived at the top (Afterimage 41.7% from 66.7%, Pawn Storm 43.1% from
   66.7%, Slipstream 51.4% from 68.1%, Schrödinger's Joker 43.1% from 66.7%, Necromancer 40.3% from
   65.3%) now read as fillers, which fits a bonus move being worth less against an opponent whose
   pieces a higher rank cannot take, though no run isolates that. Scout at 38.9% is the picker's
   Capturing pick for every default Focused build, which is why sections 11 and 13 preferred Pierce
   into them when the Capturing slot had to matter. In Full Battle thirteen cards are above the
   line: Poisoned Meat 85.4% (section 5: 77.1%), Obstinate 81.3% (95.8%), Rebirth 81.3% (72.9%),
   Riposte 81.3% (70.8%), Cleave 77.1% (58.3%), Block Path 68.8% (72.9%), Stonewall 66.7% (56.3%),
   Backdraft 64.6% (56.3%), Pierce 64.6% (47.9%, now two charges), Afterimage 62.5% (62.5%),
   Stalwart 62.5% (81.3%, paying its slot), Hit and Run 60.4% (58.3%) and Squall 60.4% (66.7%); Redo
   at 37.5% is the one liability, and Electric Slide reads 45.8% (section 5: 100.0%, before DD-106;
   section 7 read the DD-106 rule at 75.0% and section 10.1 the DD-111 rule at 62.3% over 200
   games): the forced win went with DD-106, and on these seeds the card sits under the line. Three
   cards clear the line in both formats, Obstinate, Stonewall and Squall. In the long format the
   When-captured reactions (Poisoned Meat, Rebirth, Riposte, Backdraft, Stonewall, Squall) and
   Cleave are seven of the thirteen cards that pay, beside Obstinate, Block Path, Stalwart, Pierce,
   Afterimage and Hit and Run, which reads as the long format giving reactions the captures First
   Blood never reaches; no run isolates it. Thirteen of 36 above the line is a format in which a
   third of the cards pay rather than one a few decide; the 17.2 proxy asks whether any one card
   would sit in every top loadout, and the answer is still Obstinate (decision 2), with Poisoned
   Meat (85.4% in 24 games) the one reaction to watch when live pick rates arrive.
5. **Items alone.** Nine of the sixteen items can be mirror-tested (the Attunement Charm and the
   Masquerade Mask need an element choice, Blended Family a second element, and the Headmaster's
   Ring, the two gloves and the Journeyman's Medallion are capacity items the Focused build cannot
   give up or double). In First Blood Herald's Horn (72.2%) and Mooring Chain (63.9%) read above the
   line, in Full Battle Reliquary (62.5%) and Multitasker's Schedule (60.4%); the Scout's Lens reads
   55.6% and 41.7%, the Resonance Crystal 48.6% and 43.8%, Duelist's Gauntlet 54.2% and 47.9%. Three
   of these items can do nothing in a mirror by construction (the Crystal and the Gauntlet act on a
   silence that never comes, the Horn tells each side an item list the other side's build already
   matches), so their six numbers, 43.8% to 72.2%, are the noise band of a 36- and 24-game mirror
   drawn live, and the reading rule of finding 4 applies to every item here: a side of the line in
   both formats, not a point. Reliquary is the one item that clears the line in Full Battle in both
   its runs (64.6% in section 13, 62.5% here) and sits at 51.4% in First Blood on these seeds
   against 61.1% on section 13's; a check on fresh seeds (from seed 5000, tag `b8n`) with 120 and 60
   games an item settles the two items whose numbers moved most between runs, and Mooring Chain,
   above the line in First Blood in its first run
   (`pnpm sim --suite items --items heralds_horn,reliquary,mooring_chain --format first_blood --games 120 --seed 5000 --nodes 20000`
   and the same with `--format full --games 60`): Reliquary 51.7% and 60.8%, a Full Battle item
   above the line in each of its three runs (64.6%, 62.5%, 60.8%) and no First Blood item, which
   fits a return at the end of the opponent's next turn seldom coming before the one exchange that
   decides the short format, though no run records when the return fires; Herald's Horn 49.2% and
   44.2%, the 72.2% a draw of the dice; Mooring Chain 59.6% and 54.2%, a First Blood item on the
   line; its fizzle of the first enemy push of one of its pieces (a Frost Heave, a Snowdrift) would
   be worth the most in the exchange that decides that format, though no run records the pushes it
   met. The reveal items (the Lens, the Horn, and Scout among the cards) read at or under the line
   in every run but the Horn's 72.2% draw. The Trainer does read what is revealed (its belief state
   carries every revealed opponent card and the two items the search models), and section 13
   measured the Lens's whole-set knowledge at about five points to the favoured side in Full Battle;
   what a reveal is worth to a human who plans around it is not what this NPC measures, a caveat on
   every reveal number in this document.
6. **The follow-ups.** Each follow-up is read against the shipped defaults on its own seeds (14.2's
   first two tables, 40 and 30 games per pairing: 55.4% and 72.8%), because seeds are dealt per game
   and a 60-game pairing plays different games from a 40-game one. `ONCE_PER_ABILITY` reads 54.8%
   and 61.4%: First Blood inside the noise (55.4% under `ALL_TRIGGERS` on the same seeds; two of the
   fifteen pairings differ, by half a game and by one, and section 13's probe log showed why a
   one-exchange game seldom meets a second silence) and Full Battle 1.4 points over the band, from
   72.8%, with the Crystal in every build and Scout as the Capturing card, where section 11 had
   57.9% and 62.5% with Pierce preferred; the Full Battle foil pairs read Tide over Ember 70%, Ember
   over Grove 45%, Grove over Tide 87%, Frost over Stone 57%, Stone over Storm 62% and Storm over
   Frost 48%, four of six the right way, and of the two that are not (Ember over Grove, Storm over
   Frost) the second is the Storm pair section 11 traced to Obstinate's absence. Overwhelm in
   Scout's place reads 54.6% and 71.4% (decision 5): no movement outside the noise. Cornered and
   Snowdrift preferred together read 42.7% and 70.6% (decision 8), the first an inverted wheel: the
   picker's builds for this run (`elementLoadout` with the two cards preferred) hold the signature,
   the pair, Scout and Veil (Storm: Last Word), and the two one-slot cards leave no room for
   Obstinate's two slots in five of the six, so the run is a picture of the catalogue without its
   backbone (Storm's First Blood row 65–89%, the Full Battle ply cap down from 67 games in 630 on
   the same seeds to 8) more than of the pair. Herald's Horn in the Lens's slot on the Focused build
   against the other archetypes: the Horn changes nothing in First Blood (its baseline cell for cell
   over 360 games) and one game of 144 in Full Battle (decision 9); what shows instead is the Lens's
   absence, Focused over Maximum down from 35.0% to 29.2% in First Blood and First Blood surprise
   losses at 33.6% against 30.4% with it.
7. **Lengths and ends.** Medians: First Blood 23 plies in the element suite, 15 in the archetype
   suite and 18 in the card mirrors; Full Battle 110, 78 and 91. Full Battle element games end by
   checkmate 399 times in 840, by repetition 328, at the 240-ply cap 100 times, by the fifty-move
   rule 11 and by stalemate 2: half of them end by repetition or at the cap, which section 11
   (finding 2) read as shuffles between armies whose pieces the other side's higher ranks cannot
   take, the cost of the two-slot shield in the long format and the reason decision 12 keeps the cap
   in view. First Blood ends by the objective 1,172 times in 1,260, by repetition 50, by checkmate
   32 and at the cap 6. In the archetype suite 32 of 144 Full Battle games end with a captured
   Stalwart king (36 in section 11, 13 before rule 9, which section 11 read as the thinner king set
   being hunted). Starter's games are the most one-sided (4–13% against the three in Full Battle,
   18–55% in First Blood), as a level-5 build's should be.

### 14.3 Decisions for the designer

Each is a PLAYTEST call with a measured option; none blocks the alpha, and each is one config line
or one content module away. The recommendation is the agent's best case under the delegation
(section 0); the designer can overrule any of them in section 18.

1. **The silence scope (6.2 knob, DD-108).** `ONCE_PER_ABILITY` with the shipped Crystal reads 54.8%
   and 61.4% against `ALL_TRIGGERS` at 55.4% and 72.8% on the same seeds (14.2; section 11 read
   57.9% and 62.5% on the same seeds with Pierce preferred into every build). First Blood stays
   inside the noise (section 13's probe log showed a one-exchange game seldom meeting a second
   silence, and the Crystal spares the first); Full Battle comes down to 1.4 points over the band,
   the closest a scope switch alone has brought it (section 13's 60.3% needed Pierce in every build
   and the Gauntlet on both sides), and `ONCE_PER_ABILITY` is the one scope under which Duelist's
   Gauntlet has a price. Recommendation: ship `ONCE_PER_ABILITY` (`CAPS.SILENCE_SCOPE` in
   `packages/content/config.ts`, one line; the fuzz under it is in 14.4) and keep `ALL_TRIGGERS` as
   the Trainer-tier fallback if live First Blood data shows the foil no longer matters there.
2. **Obstinate (DD-116, v3).** Alone it reads 75.0% and 81.3% (section 11: 79.2% and 72.9%, on other
   seeds), one of the three cards above the line in both formats (with Stonewall and Squall) and the
   one the picker deals into five of the six Focused builds, and it is the card section 11 put
   behind Tide's First Blood row, Storm's Full Battle row and the Maximum-Focused archetype gap
   (section 11, findings 2, 4 and 6). Options: (a) ship as is and read the live pick rate (17.2's
   real metric); (b) level 20, so it arrives with the Ring rather than in the first week; (c) a
   rework that keeps the identity and narrows the cover: pawns and knights only (the pieces a higher
   rank is meant to take), which the picker would still deal and the mirror would re-measure in one
   run. Recommendation: (c), measured before Playtest Gate 1; (b) is the fallback that costs
   nothing.
3. **Duelist's Gauntlet (DD-126).** Under `ALL_TRIGGERS` its cost half is already charged by the
   element rule, so it is pure upside: with Pierce in every build it takes the Full Battle
   advantaged element from 71.9% to 60.3% by neutralising the wheel in the pairs where the wheel
   silenced Pierce (section 13). Options: a higher level (18 or above), a real price under every
   scope (the wearer's When-captured cards silenced by every opponent, not only the foil), or the
   item as is under `ONCE_PER_ABILITY`, where its cost exists. Recommendation: decision 1 settles
   it; if `ALL_TRIGGERS` stays, level 18.
4. **Reliquary (DD-127).** 61.1% and 64.6% alone in section 13, above the line in both formats, and
   51.4% and 62.5% in 14.1's item table on other seeds (51.7% and 60.8% on 120 and 60 fresh games: a
   Full Battle item, above the line in each of its three Full Battle runs). Options: level 16 or
   above; the return at the end of the owner's second turn (one more turn in which the opponent can
   occupy the start square); pieces up to a knight (a returned major piece is the largest swing the
   item can make; no run records which piece came back). Recommendation: the rank cap, which keeps
   the identity (a relic brings back the fallen, not the queen) and is one line in the module;
   measured with `--suite items` in one run.
5. **Overwhelm (DD-125).** 63.9% and 64.6% alone (section 12), 54.2% and 58.3% in the
   whole-catalogue run on other seeds (14.1). Preferred into every Focused build in Scout's place,
   the advantaged element reads 54.6% and 71.4% against 55.4% and 72.8% on the same seeds (14.2): no
   movement outside the noise; Tide's rows barely move (First Blood 63–79% from 68–79%, Full Battle
   20–100% from 13–100%) and Storm's Full Battle row falls further (0–10% against four elements,
   from 0–23%), which reads as a conditional Capturing card not being what Storm lacks, and the
   one-charge-or-level question sits inside the mirror's noise, not above it. Recommendation: keep
   Overwhelm at two charges and level 9 and read the live pick rate; if a brake is wanted, one
   charge is the lighter touch, as Pierce's second charge was its First Blood edge (section 11); no
   one-charge run exists yet.
6. **Redo (DD-119, v2).** 61.1% alone in First Blood and 37.5% in Full Battle (section 11: 55.6% and
   33.3%, on other seeds): a First Blood card and a Full Battle liability, which fits section 11's
   reading of the card (a second try for the opponent at a piece it has already chosen to take),
   punished in a long game and never reached in a short one. Not a balance fault but a format split
   the card text does not announce. Options: keep it and let the pick rate by format speak; rework
   the rewind so the captor returns to its square and loses the tempo (no retake); retire it to the
   later shelf (`retired`, as Schrödinger's Joker's flag works). Recommendation: keep, with the
   split in the card's long text, and revisit with live data; the rework is the fallback if Full
   Battle players never pick it.
7. **Ricochet (DD-124).** 50.0% and 39.6% alone (section 12), 51.4% and 54.2% in 14.1 on other
   seeds, with an NPC that does not plan the continuation square. This is a tooling follow-up, not a
   design call: the search needs a `Played` relocation for the captor (one line each in `play` and
   `unplay`, as the Frost Heave push) before the card's number means anything. Recommendation: the
   search change first, then the mirror again; the card stays.
8. **Cornered and Snowdrift (DD-123).** Cornered alone reads 50.0% and 56.3% in section 12 and 44.4%
   and 58.3% in 14.1 (other seeds); with its partner Snowdrift preferred into every Focused build
   the advantaged element reads 42.7% and 70.6% against 55.4% and 72.8% on the same seeds (14.2).
   The picker's builds for this run hold the signature, the pair, Scout and Veil, Storm's Last Word
   in Veil's place (`elementLoadout` with the two cards preferred): the two one-slot cards leave no
   room for Obstinate's two slots in five of the six, so the run measures a catalogue without its
   backbone more than the pair. First Blood inverts (42.7% against 55.4%): White 43.0%, Storm's row
   65–89% (a reading: its turning sliders meet no Obstinate in any build), Ember over Tide 82.5%
   where the same seeds give 31% under the defaults. Full Battle reads 70.6% (72.8% on the same
   seeds) with Stone's row up against Ember, Tide and Grove (82%, 78% and 42% from 55%, 55% and 30%)
   and down against Storm and Frost, Frost's row up against all five (35–75% from 23–58%), the games
   shorter (median 99 plies) and the ply cap all but gone (8 games of 630 against 67 at the defaults
   on the same seeds), which reads as the long format ending once the shield is gone (section 11,
   finding 2, for the shuffle reading). The pair's own share cannot be separated here, since a rim
   trap needs the opponent to take on the rim and Snowdrift moves enemy pieces, not the Cornered
   one; Cornered alone stays where its mirrors put it, around the line in Full Battle and under it
   in First Blood. Recommendation: no change to either card; what this run shows is decision 2's
   rework from the other side, a Full Battle without Obstinate's shuffles, which is worth the
   designer's eye more than the pair is.
9. **Herald's Horn (DD-128).** Worth nothing in a mirror (section 13); on the Focused build in the
   Lens's slot, against the three other archetypes with the Lens out of both runs (where the item
   lists differ), the Horn changes nothing in First Blood (360 games, the baseline cell for cell)
   and one game in Full Battle (Flexible over Focused 39.6% to 43.8%, 24 games): the Trainer's
   search uses the opponent's revealed items in two places, the root move resolved with them as
   revealed (`beliefState`) and the fast search reading the list for a Gauntlet and a Reliquary
   (`knownItem` in `packages/ai/src/index.ts`); the builds in this suite carry neither of those two,
   and what the Horn adds at the root (the Flexible build's Crystal, the capacity items) changed one
   game in 144. The item's worth is a human's: knowing the whole list before the first exchange
   changes what a player risks, where the search reads two items. Recommendation: keep the Horn as
   it is, a cheap information item at level 7, harmless by construction (both lists are revealed)
   and unmeasurable by the Trainer; read it from live pick rates.
10. **Surprise losses in First Blood.** 0.0% in the element and card suites by construction (every
    Focused build carries Scout's Lens and one army-wide set), 30.4% in the archetype suite, where
    Maximum and Flexible keep per-type sets the Lens does not open, against the 15% target; 23.8% in
    the element suite without the Lens (section 13). The short format is decided by the first
    exchange, and a hidden card in that exchange is the metric's whole content. Options: (a) accept
    it as the format's nature and re-count from live loadouts; (b) a battle-start reveal of both
    pawn sets for everyone (the Horn's cousin for abilities, one neutral item or a format rule); (c)
    a Lens that opens the whole army. Recommendation: (a), with (b) as the First Blood format rule
    if the live number stays above 15%.
11. **The archetype gap.** Maximum over Focused reads 70.8% in Full Battle (section 11: 72.9%) with
    the other two pairs 62.5% and 52.1%, which section 11 (finding 6) read as the Stalwart king plus
    Obstinate on every type against Obstinate alone. Decision 2's rework is the lever; nothing else
    cheap moves it. Recommendation: no further change before live data; Focused is the build of the
    first month, not the ranked ladder.
12. **Clocks (R-FMT-001, PROVISIONAL).** The median Full Battle game is 110 plies and 100 of the 840
    element-suite games reach the 240-ply cap (section 11, finding 2, read the capped and repeated
    games as shuffles); the median First Blood game is 23 plies. The shipped PROVISIONAL clocks are
    3+2 for First Blood and 10+5 for Full Battle. At ten seconds a move, 55 moves a side is about 18
    minutes of Full Battle and 11 moves a side about 4 minutes of First Blood, inside the 17.2 bands
    (10–25 and 2–5 minutes), and the ply cap already ends the shuffles. Recommendation: keep the
    clocks and re-read them from live game lengths after the first month; the only lever worth
    preparing is a repetition-count draw rule shorter than the cap if live Full Battle games cluster
    at it.

### 14.4 Fuzz

`tsx apps/tools/src/fuzz/cli.ts --games 3000` at the shipped scope: 3,000 games, 272,929 plies,
replays identical (INV-04), all 3,000 games projection-scanned for both players and a spectator
(R-SEC-001, R-INFO-005), no crash, at most 20 events in one action, 382 games at the 300-ply cap;
results white 957 and black 1,026 by objective, 33 and 52 by checkmate, 9 and 12 by a captured
Stalwart king, 290 fifty-move, 133 repetition and 106 stalemate draws (the fuzz writes
`reports/fuzz-3000.json`, which the second run below overwrote, so this paragraph is the record of
the first run; the PROGRESS evidence log repeats its summary). The same under
`--silence ONCE_PER_ABILITY`: 3,000 games, 274,111 plies, replays identical, all 3,000
projection-scanned, no crash, 385 games at the cap; white 960 and black 1,023 by objective, 27 and
48 by checkmate, 9 and 12 by a captured Stalwart king, 290 fifty-move, 130 repetition and 116
stalemate draws. The once-per-ability record (`state.silenced`) changes no replay and leaks nothing
to a spectator across the 3,000 games under that scope, so the scope switch of decision 1 is a
config line with its fuzz already run.
