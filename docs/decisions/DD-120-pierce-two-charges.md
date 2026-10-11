# DD-120: Pierce (5.7) gets `limits: { perAction: 1, charges: 2 }` (packages/content/abilities/pierce.ts, version 3; text "(2 charges)"): each piece negates a victim's Captured abilities twice per battle, after which its captures let them resolve

Status: binding under D-37 (designer may overrule).
Spec: 5.7, 6.2, R-ABIL-003, R-ABIL-005, R-FMT-005, DD-17, DD-98, DD-108

## Decision

Pierce (5.7) gets `limits: { perAction: 1, charges: 2 }` (packages/content/abilities/pierce.ts, version 3; text "(2 charges)"): each piece negates a victim's Captured abilities twice per battle, after which its captures let them resolve. A charge is spent whenever Pierce fires, including on a victim that had nothing to negate, because the engine's negate effect resolves when it is registered (DD-17); a fizzle there would reveal that the victim carries no Captured ability, so the engine is left as it is and the behaviour is pinned in pierce.test.ts. The NPC search does not model charges and profiles abilities from their effect primitives, so packages/ai is unchanged and R-FMT-005 holds.

## Why it is the best case

The B3 silence runs found Pierce deciding the scope question: under `REACTIONS_ONLY` Grove over Tide fell from 65% to 8% "because Tide's Pierce, no longer silenced, negates Poisoned Meat on every capture", and the report concluded that scope "makes Pierce the best card in the game" (docs/BALANCE_BASELINE.md section 8, findings 2 and 4); with the Crystal spared under `ONCE_PER_ABILITY` Tide (Flow, Hit and Run, Pierce) beat every element at 60-100% in Full Battle (finding 3). On its own the card reads an unremarkable 54.2% in First Blood and 47.9% in Full Battle (section 5), so the problem is unlimited repetition on a Capturing card, not its single use; section 10 finding 2 names "Pierce at two charges" as the Tide lever after the Flow cap moved nothing (Tide's row 63-83% in First Blood, 78-99% in Full Battle). Two charges match the other repeatable control cards (Momentum, Snowbound, Quantum Kill at 2, DD-94's reasoning that "charge limits cap repeatable control") and keep the first-strike and the reveal the card buys.
