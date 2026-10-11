# DD-119: Redo (5.8) is eligible on every piece type but the pawn: `eligible: ['knight', 'bishop', 'rook', 'queen', 'king']` in packages/content/abilities/redo.ts (version 2), the 5.7 row reads Non-pawn and the 5.8 row says a pawn carrying it is captured without a rewind

Status: binding under D-37 (designer may overrule).
Spec: 5.7, 5.8, 7.3, R-ABIL-005, R-ABIL-002, DD-97, DD-100

## Decision

Redo (5.8) is eligible on every piece type but the pawn: `eligible: ['knight', 'bishop', 'rook', 'queen', 'king']` in packages/content/abilities/redo.ts (version 2), the 5.7 row reads Non-pawn and the 5.8 row says a pawn carrying it is captured without a rewind. The rule follows 7.3 as it stands: an ineligible ability in a set does nothing on that type but still uses the slot, and the engine's trigger collection (`eligibleFor`, action.ts) skips it, so no engine change was needed. Everything else about Redo (rank condition, 1 charge, replay tag, DD-100's rewind semantics) is unchanged.

## Why it is the best case

Redo's condition is a captor of equal or higher rank (DD-97), and a pawn is rank 1, so a pawn carrying Redo rewound almost every capture of it: the cheapest piece bought back a whole exchange for one slot. The baseline measured Redo as a 61.1% card in First Blood (docs/BALANCE_BASELINE.md section 5, above the 60% line, in the 61-69% band of finding 7) and a 37.5% liability in Full Battle (median 103 plies), the second figure saying as much about the NPC's model of a rewind as about the card; removing the pawn case takes away the degenerate use without touching the knight-and-up cases E16 and the golden tests cover, and it is the designer's B5 brief (docs/BALANCE_BASELINE.md section 11: "Redo is not eligible on pawns"). The rank order 5.1 is COMMITTED and is not changed; only the PLAYTEST eligibility is.
