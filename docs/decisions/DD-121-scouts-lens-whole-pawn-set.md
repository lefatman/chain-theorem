# DD-121: At battle start Scout's Lens reveals the opponent's whole pawn set, every ability in it in the set's order, and the pawn type reads complete (packages/content/items/scouts_lens.ts, version 2): the item issues the engine's existing `set` reveal, the same path Scout's and Last Word's typeSet reveals use, so host.ts merges the names and adds 'pawn' to `reveals.complete`, the AI's belief state stops treating pawns as uncertain, spectators see it (DD-92), and veiled abilities are named because explicit reveals bypass Veil (DD-28)

Status: binding under D-37 (designer may overrule).
Spec: 7.2, 8.2, 17.2, R-LOAD-002, R-INFO-002, R-INFO-005, DD-27, DD-28, DD-92

## Decision

At battle start Scout's Lens reveals the opponent's whole pawn set, every ability in it in the set's order, and the pawn type reads complete (packages/content/items/scouts_lens.ts, version 2): the item issues the engine's existing `set` reveal, the same path Scout's and Last Word's typeSet reveals use, so host.ts merges the names and adds 'pawn' to `reveals.complete`, the AI's belief state stops treating pawns as uncertain, spectators see it (DD-92), and veiled abilities are named because explicit reveals bypass Veil (DD-28). An empty pawn set is revealed as complete too (the opponent learns the pawns carry nothing). The Lens itself is still revealed when it fires (DD-27); cost and level stay 1 slot, level 3.

## Why it is the best case

The Lens was in every simulated Focused build and still left First Blood surprise losses far above the <15% target: docs/BALANCE_M7.md section 4 item 5 recorded 33-55% "even though every simulated Focused build carries Scout's Lens (the first ability of the opponent's pawn set)" and listed "a Lens that reveals the whole pawn set" as the ready-to-test fix; docs/BALANCE_DD98.md measured 35% in First Blood after the neutral conversion, and the baseline's stricter metric still reads 35% for the archetype suite in the short format (docs/BALANCE_BASELINE.md section 6 finding 6), with the reacting signatures (Poisoned Meat, Stonewall, Frost Heave, 72 of 77 surprise wins) on pawns the Lens only half-read. Spec 17.2 says to add reveal tools before hidden power when that rate is high, and a complete pawn set is the information tool pillar 1 (calculable depth) asks for; the designer's B5 brief names the change (section 11).
