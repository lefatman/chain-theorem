# DD-113: Bulwark (Stone, 6.1) covers Stone pieces other than pawns: the first effect capture targeting each of your Stone non-pawn pieces each battle fizzles, and a Stone pawn is removed by effect captures like any pawn

Status: binding under D-37 (designer may overrule).
Spec: 6.1, R-ELEM-001, R-FMT-005, DD-19, DD-26, DD-35

## Decision

Bulwark (Stone, 6.1) covers Stone pieces other than pawns: the first effect capture targeting each of your Stone non-pawn pieces each battle fizzles, and a Stone pawn is removed by effect captures like any pawn. Whether pawns are covered too is the PLAYTEST knob CAPS.TRAITS.BULWARK_PAWNS (default false; true restores the launch rule, every Stone piece). The identity stays COMMITTED; the NPC model (traitEffects, fed the captor's type and the engine's caps) and the Masquerade Mask's shown-Stone contradiction check read the same knob, so by default a Stone pawn captor is expected to die to a known Poisoned Meat and a masked pawn's loss under shown Stone gives nothing away.

## Why it is the best case

DD-98 (docs/BALANCE_DD98.md sections 2 and 4) found First Blood decided by two traits, Flow and Bulwark, the first effect capture on each piece fizzling and blunting Backdraft, Cleave, Poisoned Meat and Quantum Kill at once: Stone won every First Blood column (56-78%) and its foil pair pointed the wrong way (Frost over Stone 22%), and DD-98 named Bulwark's number, not its identity, as the lever. After the Electric Slide fixes (docs/BALANCE_BASELINE.md sections 7 and 9) Stone still beat its foil in First Blood (Frost over Stone 40%) and read 58% over Storm, 99% in Full Battle, against the 55-60% target. Pawns are where that edge is cheapest and most frequent: Cleave targets pawns only, Backdraft's and Quantum Kill's targets are mostly pawns, and a Stone pawn captor took Poisoned Meat for free, so sixteen pawns' worth of fizzles blunted the whole Capturing and Captured layer. Dropping pawns from cover removes those free trades while keeping Protection on the pieces First Blood's objective counts, and the knob keeps the launch rule one config line away for the paired run in section 10 of the baseline.
