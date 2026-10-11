# DD-114: Overabundance gives every consumable ability on a Grove piece one extra charge instead of doubling it

Status: binding under D-37 (designer may overrule).
Spec: 6.1, 6.4, R-ELEM-007, R-ELEM-001, DD-43

## Decision

Overabundance gives every consumable ability on a Grove piece one extra charge instead of doubling it. The number is a PLAYTEST knob, CAPS.TRAITS.OVERABUNDANCE ({ mode: 'add', amount: 1 } ships; { mode: 'multiply', amount: 2 } restores the launch rule), read by the trait module and overridable with the simulator's and fuzzer's --caps; the identity (R-ELEM-007, 6.1) stays COMMITTED, as does DD-43's battle-start fixing of the bonus, and E9 is unchanged because Rebirth's single charge reads 2 either way.

## Why it is the best case

The designer's B4 brief asks for +1 rather than x2, and the measurements say the doubling was never where Grove's balance lived: docs/BALANCE_DD98.md section 4 finds that in First Blood Hot Foot and Overabundance barely register in 17 plies, and the Grove Focused build (Poisoned Meat, Snowdrift, Scout, Obstinate, Last Word) carries no consumable at all, so Grove's matchup figures come from the silence rule and Poisoned Meat, not from charge counts. What x2 did do was scale with the card: the two-charge cards became four (Momentum, Quantum Kill, Snowbound; five Momentum charges with the Mainspring) while the eight one-charge consumables got 2; the cards suite (docs/BALANCE_BASELINE.md section 5) rates those two-charge cards as middling (Momentum 52.8%, Quantum Kill 52.8%, Snowbound 45.8% in First Blood) and the one-charge revives as the strong ones (Rebirth 72.9%, Necromancer 62.5% in Full Battle), so a flat +1 leaves every one-charge card at its launch count on a Grove piece, trims only the 4s to 3, and makes Grove's endurance a uniform second life per card rather than a multiplier that rewards stacking tempo and removal cards. Section 10 of the baseline measures add 1 against multiply 2.
