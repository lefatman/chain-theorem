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
consumable; at the shipped defaults the advantaged element reads 48.3% and 73.5%.

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

| ember | mirror, white 51.7% | 29.2% | 47.5% | 81.7% | 59.2% | 57.5% |
| tide | 70.8% | mirror, white 35.0% | 67.5% | 68.3% | 87.5% | 68.3% |
| grove | 52.5% | 32.5% | mirror, white 30.8% | 63.3% | 63.3% | 45.8% |
| storm | 18.3% | 31.7% | 36.7% | mirror, white 57.5% | 41.7% | 32.5% |
| stone | 40.8% | 12.5% | 36.7% | 58.3% | mirror, white 65.0% | 60.0% |
| frost | 42.5% | 31.7% | 54.2% | 67.5% | 40.0% | mirror, white 51.7% |

Advantaged element: **46.9%**. White 52.1%, surprise losses 10.2%, median 25 plies. Result reasons: repetition 83, objective 1070, checkmate 102, ply_cap 5.

**Element matchups, Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

| ember | mirror, white 40.0% | 18.8% | 76.3% | 92.5% | 65.0% | 47.5% |
| tide | 81.3% | mirror, white 51.2% | 20.0% | 100.0% | 92.5% | 88.8% |
| grove | 23.8% | 80.0% | mirror, white 55.0% | 91.3% | 47.5% | 81.3% |
| storm | 7.5% | 0.0% | 8.8% | mirror, white 53.8% | 1.3% | 23.8% |
| stone | 35.0% | 7.5% | 52.5% | 98.8% | mirror, white 53.8% | 43.8% |
| frost | 52.5% | 11.3% | 18.8% | 76.3% | 56.3% | mirror, white 53.8% |

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

| maximum | — | 68.3% | 49.2% | 58.3% |
| flexible | 31.7% | — | 44.2% | 60.0% |
| focused | 50.8% | 55.8% | — | 84.2% |
| starter | 41.7% | 40.0% | 15.8% | — |

White 50.7%, surprise losses 22.5%, median 19 plies. Result reasons: objective 340, checkmate 11, repetition 8, ply_cap 1.

**First Blood, Stalwart kings paid for** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000 --king stalwart`

| maximum | — | 66.7% | 58.3% | 58.3% |
| flexible | 33.3% | — | 53.3% | 66.7% |
| focused | 41.7% | 46.7% | — | 84.2% |
| starter | 41.7% | 33.3% | 15.8% | — |

White 49.6%, surprise losses 27.3%, median 18 plies. Result reasons: objective 348, checkmate 6, repetition 5, stalwart_captured 1.

**Full Battle, the 7.3 item lists, no Stalwart** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| maximum | — | 50.0% | 68.8% | 97.9% |
| flexible | 50.0% | — | 64.6% | 95.8% |
| focused | 31.3% | 35.4% | — | 87.5% |
| starter | 2.1% | 4.2% | 12.5% | — |

White 49.7%, surprise losses 7.2%, median 64 plies. Result reasons: repetition 28, checkmate 111, ply_cap 4, fifty_move 1.

**Full Battle, Stalwart kings paid for** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000 --king stalwart`

| maximum | — | 41.7% | 81.3% | 91.7% |
| flexible | 58.3% | — | 87.5% | 93.8% |
| focused | 18.8% | 12.5% | — | 87.5% |
| starter | 8.3% | 6.3% | 12.5% | — |

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

| ember | mirror, white 51.7% | 31.7% | 47.5% | 66.7% | 59.2% | 59.2% |
| tide | 68.3% | mirror, white 50.0% | 65.0% | 63.3% | 83.3% | 70.8% |
| grove | 52.5% | 35.0% | mirror, white 30.8% | 35.0% | 64.2% | 45.8% |
| storm | 33.3% | 36.7% | 65.0% | mirror, white 41.7% | 60.8% | 60.0% |
| stone | 40.8% | 16.7% | 35.8% | 39.2% | mirror, white 65.0% | 60.0% |
| frost | 40.8% | 29.2% | 54.2% | 40.0% | 40.0% | mirror, white 51.7% |

Advantaged element: **48.3%**. White 54.4%, surprise losses 9.6%, median 23 plies. Result reasons: repetition 65, objective 1099, checkmate 89, ply_cap 7.

**Element matchups at the shipped defaults, Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

| ember | mirror, white 40.0% | 11.3% | 77.5% | 100.0% | 68.8% | 56.3% |
| tide | 88.8% | mirror, white 61.3% | 23.8% | 98.8% | 92.5% | 77.5% |
| grove | 22.5% | 76.3% | mirror, white 55.0% | 88.8% | 70.0% | 81.3% |
| storm | 0.0% | 1.3% | 11.3% | mirror, white 46.3% | 5.0% | 47.5% |
| stone | 31.3% | 7.5% | 30.0% | 95.0% | mirror, white 53.8% | 43.8% |
| frost | 43.8% | 22.5% | 18.8% | 52.5% | 56.3% | mirror, white 53.8% |

Advantaged element: **73.5%**. White 51.5%, surprise losses 1.1%, median 66 plies. Result reasons: checkmate 628, repetition 176, stalemate 4, ply_cap 27, fifty_move 5.

**Build archetypes at the shipped defaults, First Blood** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

| maximum | — | 62.5% | 58.3% | 58.3% |
| flexible | 37.5% | — | 58.3% | 65.0% |
| focused | 41.7% | 41.7% | — | 80.0% |
| starter | 41.7% | 35.0% | 20.0% | — |

White 47.4%, surprise losses 33.2%, median 17 plies. Result reasons: objective 343, stalwart_captured 2, repetition 5, checkmate 10.

**Build archetypes at the shipped defaults, Full Battle** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| maximum | — | 56.3% | 81.3% | 100.0% |
| flexible | 43.8% | — | 87.5% | 93.8% |
| focused | 18.8% | 12.5% | — | 91.7% |
| starter | 0.0% | 6.3% | 8.3% | — |

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
