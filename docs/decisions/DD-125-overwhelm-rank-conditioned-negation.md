# DD-125: Overwhelm (plan item C6; designer brief 2026-10-09) ships as Capturing, neutral, eligible on every type, level 9, one slot, two charges, built from existing primitives: the trigger condition { rank: { of: 'captor', cmp: '>', to: 'victim' } } and fx.negate('victim', ['CAPTURED'])

Status: binding under D-37 (designer may overrule).
Spec: 5.1, 5.2, 5.6, 5.7, R-ABIL-002, R-ABIL-005, DD-97, DD-120, plan item C6

## Decision

Overwhelm (plan item C6; designer brief 2026-10-09) ships as Capturing, neutral, eligible on every type, level 9, one slot, two charges, built from existing primitives: the trigger condition { rank: { of: 'captor', cmp: '>', to: 'victim' } } and fx.negate('victim', ['CAPTURED']). It triggers only when the captor outranks the victim (5.1, DD-97: pawn 1 < knight = bishop 2 < rook 3 < queen 4 < king 5), so against an equal or higher rank there is no event, no reveal and no charge; when it fires it spends a charge whether or not the victim had anything to negate, exactly as Pierce does (DD-17), and the foil silences it like any Capturing card.

## Why it is the best case

The brief asks for a rank-conditioned Pierce that lands where Redo and Poisoned Meat hurt most (a rook taking a knight) without being a global off-switch. The rank trigger condition already exists (Redo, Necromancer, Quantum Kill and Schrödinger's Joker use it) and conditions keep the card hidden when it does not apply, so no engine change is needed. Charging it like Pierce keeps the two negation cards consistent and keeps the NPC's charge accounting (DD-120) valid for both.
