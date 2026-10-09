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

@@EL_FB@@

**Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

@@EL_FULL@@

## 3. The `REACTIONS_ONLY` silence scope

6.2 says to test `REACTIONS_ONLY` first when the disadvantaged side loses too often; with every build
now carrying a Capturing card (Scout), the knob changes games. Same seeds as section 2, so each
cell is a paired comparison with the table above.

**First Blood** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000 --silence REACTIONS_ONLY`

@@EL_FB_RO@@

**Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000 --silence REACTIONS_ONLY`

@@EL_FULL_RO@@

## 4. Build archetypes

**First Blood** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

@@AR_FB@@

**Full Battle** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

@@AR_FULL@@

Under `REACTIONS_ONLY` (same commands with `--silence REACTIONS_ONLY`):

@@AR_RO@@

## 5. One card at a time: the mirror tests

`pnpm sim --suite cards` plays, for each ability, the element's Focused build with the card in front
of its four best other cards against those four cards alone. Both sides are the same element, so no
silence applies and both have the same trait: the score is the card's own worth at the Trainer's
level of play. A neutral card cycles through the six elements (both colours per element); a
signature plays on its own element, where it is Attuned. A card above 60% wins games by itself; the
17.2 proxy is that no ability's pick rate in top loadouts exceeds 40%. Cards that the tested card
excludes are left out of both sides (Stalwart: Capturing and Captures, rule 8).

**First Blood** — `pnpm sim --suite cards --format first_blood --games 36 --nodes 20000`

@@CARDS_FB@@

**Full Battle** — `pnpm sim --suite cards --format full --games 24 --nodes 20000`

@@CARDS_FULL@@

## 6. What the data says

@@FINDINGS@@
