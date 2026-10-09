# DD-109: Stalwart on the king costs one item slot (loadout rule 9): an ability may declare kingItemSlots, added to the item slot total of rule 1 when the set that applies to the king holds it (the sixth per-type set or the army-wide set); the total stays public under 8.1, deductions treat an unrevealed king slot as either an item or the king cost, and the simulator's archetype builds pay it by giving up Blended Family (Maximum) or the utility item (Flexible) under --king stalwart

Status: binding under D-37 (designer may overrule).
Spec: 4.3, 5.7, 7.3, 7.4, 8.1, R-LOAD-004, R-RULES-003, R-INFO-003

## Decision

Stalwart on the king costs one item slot (loadout rule 9): an ability may declare kingItemSlots, added to the item slot total of rule 1 when the set that applies to the king holds it (the sixth per-type set or the army-wide set); the total stays public under 8.1, deductions treat an unrevealed king slot as either an item or the king cost, and the simulator's archetype builds pay it by giving up Blended Family (Maximum) or the utility item (Flexible) under --king stalwart.

## Why it is the best case

Designer answer 2026-10-09 to the baseline's question (docs/BALANCE_BASELINE.md finding 3): yes, Stalwart on a king should cost a slot. An ability slot would cost nothing in practice, because a per-type king set has nothing better to hold (Captured cards and Obstinate are inert on a king) while the Stalwart king decided Full Battle between archetypes (Maximum and Flexible 79-88% over Focused); an item slot is the one currency every archetype spends, so the uncatchable king now costs a second element or a utility. Declared as module data, so no engine code names Stalwart.
