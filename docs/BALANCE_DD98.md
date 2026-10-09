# Balance after the neutral-first catalogue (DD-98)

The designer's 2026-10-06 brief made most abilities neutral: each element keeps one signature card
with an affinity and an Attuned bonus, everything else is neutral (spec 5.7, DD-98). This report
re-runs the M7 balance method on that catalogue so the change can be judged against the 17.2 targets
(R-TEST-002). Nothing COMMITTED was touched; the simulator and its builds are the ones from
`docs/BALANCE_M7.md` section 1.

**Status.** In First Blood the advantaged-element score falls from 64% to **46%**: the short format
no longer rewards the foil, because the silence rule rarely fires before the first non-pawn capture
and the traits now decide (Tide's Flow and Stone's Bulwark beat everything, three of the six foil
pairs point the wrong way). In Full Battle it rises from 73% to **90%**: with identical neutral cards
on both sides, a long game is decided by whose triggers are silenced. White score and Full Battle
surprise losses meet the targets; First Blood surprise losses (35%) still miss. The archetype suite
shows the Maximum build ahead (65–75% in Full Battle). Section 4 lists the levers; they are the
designer's. (Section 4's item 4, the build picker, has since been done: `docs/BALANCE_BASELINE.md`
re-measures everything here with builds that carry all four categories and the passives.)

## 1. Method

Same as `docs/BALANCE_M7.md` section 1: `pnpm sim`, Trainer tier on both sides, 20,000 nodes per
move, 60 games per element pairing in First Blood and 40 in Full Battle, the archetype suite at 60
and 24, colours alternating, draws counting as half a win, every army level 25. Element builds are
mono-element Focused builds (Headmaster Ring, Resonance Crystal, Scout's Lens); with the neutral
catalogue every element now plays its signature plus the same best neutral cards, so the matchup
tables isolate trait + signature + silence.

## 2. Element matchups

Row element's score against the column element. Advantaged pairs: Tide over Ember, Ember over Grove,
Grove over Tide, Storm over Frost, Frost over Stone, Stone over Storm.

**First Blood** — `pnpm sim --suite elements --format first_blood --games 60 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 63.3% | 40.0%               | 35.0%               | 46.7%               | 44.2%               | 39.2%               |
| tide          | 60.0%               | mirror, white 83.3% | 66.7%               | 40.0%               | 35.0%               | 88.3%               |
| grove         | 65.0%               | 33.3%               | mirror, white 54.2% | 53.3%               | 36.7%               | 38.3%               |
| storm         | 53.3%               | 60.0%               | 46.7%               | mirror, white 44.2% | 25.8%               | 54.2%               |
| stone         | 55.8%               | 65.0%               | 63.3%               | 74.2%               | mirror, white 52.5% | 78.3%               |
| frost         | 60.8%               | 11.7%               | 61.7%               | 45.8%               | 21.7%               | mirror, white 59.2% |

Advantaged element: **46.4%** (M7: 64.0%). White: 51.4%. Surprise losses: 35.2%. Median 17 plies.
Three foil pairs point the wrong way (Ember over Grove 35%, Grove over Tide 33%, Frost over Stone
22%); Stone and Tide win almost every column.

**Full Battle** — `pnpm sim --suite elements --format full --games 40 --nodes 20000`

| Row vs column | ember               | tide                | grove               | storm               | stone               | frost               |
| ------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| ember         | mirror, white 47.5% | 3.8%                | 92.5%               | 46.3%               | 76.3%               | 51.2%               |
| tide          | 96.3%               | mirror, white 41.3% | 8.8%                | 63.7%               | 82.5%               | 83.8%               |
| grove         | 7.5%                | 91.3%               | mirror, white 48.8% | 33.8%               | 48.8%               | 67.5%               |
| storm         | 53.8%               | 36.3%               | 66.3%               | mirror, white 50.0% | 2.5%                | 77.5%               |
| stone         | 23.8%               | 17.5%               | 51.2%               | 97.5%               | mirror, white 46.3% | 16.3%               |
| frost         | 48.8%               | 16.3%               | 32.5%               | 22.5%               | 83.8%               | mirror, white 52.5% |

Advantaged element: **89.8%** (M7: 73.1%). White: 47.9%. Surprise losses: 0.0%. Median 79 plies.
Every foil pair points the right way, far too strongly: the silenced side's reactions never fire.

**The `REACTIONS_ONLY` knob could not be measured with these builds.** 6.2 says to test it first
when the disadvantaged side loses too often, but the Focused build picker fills its five slots with
the signature, three Captured cards and one Captures card, so no Capturing ability is on the board
and `--silence REACTIONS_ONLY` reproduces the `ALL_TRIGGERS` tables to the decimal. A run with the
Flexible or Maximum archetypes (per-type sets) is needed for that knob; it is listed in section 4.

## 3. Build archetypes

**First Blood** — `pnpm sim --suite archetypes --format first_blood --games 60 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 69.2%    | 43.3%   | 56.7%   |
| flexible      | 30.8%   | —        | 58.3%   | 56.7%   |
| focused       | 56.7%   | 41.7%    | —       | 44.2%   |
| starter       | 43.3%   | 43.3%    | 55.8%   | —       |

White 50.8%, surprise losses 42.5%, median 14 plies.

**Full Battle** — `pnpm sim --suite archetypes --format full --games 24 --nodes 20000`

| Row vs column | maximum | flexible | focused | starter |
| ------------- | ------- | -------- | ------- | ------- |
| maximum       | —       | 64.6%    | 64.6%   | 75.0%   |
| flexible      | 35.4%   | —        | 39.6%   | 68.8%   |
| focused       | 35.4%   | 60.4%    | —       | 75.0%   |
| starter       | 25.0%   | 31.3%    | 25.0%   | —       |

White 49.3%, surprise losses 1.0%, median 61 plies. The 17.2 target (each of Maximum, Flexible and
Focused at 45–55% against the others) is missed by Maximum in both formats and by Flexible in Full
Battle.

## 4. What this means and the designer's levers

1. **Short games are trait games.** With equal neutral cards, First Blood is decided by the traits,
   and two traits are far ahead: Flow (mobility through own pieces) and Bulwark (the first effect
   capture on each piece fizzles, which blunts Backdraft, Cleave, Poisoned Meat and Quantum Kill at
   once). Hot Foot and Overabundance barely register in 17 plies. Trait identities are COMMITTED
   (6.1) but their numbers are not: Hot Foot's burn length, Bulwark's "first" versus "once per
   battle", Overabundance's doubling.
2. **Long games are silence games.** In Full Battle the foil wins 90%. The spec's own knob for this
   is `silenceScope` (6.2, "scope tunable"): `REACTIONS_ONLY` spares the disadvantaged captor's
   Capturing abilities. Measuring it needs builds that carry Capturing cards (section 2).
3. **Signatures could carry more of the identity.** Each signature now sits at levels 1–3 and is
   the only card with an Attuned bonus; a stronger Attuned bonus on the four weaker elements'
   signatures (Ember's Cleave, Grove's Poisoned Meat, Storm's Squall, Frost's Frost Heave) would
   move First Blood without touching the traits.
4. **Build picker.** The Focused archetype's category cap (at most three slots per category) is why
   every element plays the same four neutral cards; a picker that spreads across all four categories
   would also make the `REACTIONS_ONLY` run meaningful. This is simulator tooling, not game design,
   and can be done without a designer decision.

Questions for the designer, in order: (a) accept the trait-led First Blood picture or tune Flow and
Bulwark; (b) which `silenceScope` to ship; (c) whether the Attuned bonuses of the weaker signatures
should grow. The Phase 2–6 abilities (Necromancer, Quantum Kill and the rest, spec 5.8) are being
added on top of this catalogue and each gets its own simulator run.
