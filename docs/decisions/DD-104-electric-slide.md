# DD-104: Electric Slide is Storm's signature with a base/attuned split: base (any army) lets a pawn move straight over one adjacent allied piece to the empty square beyond; attuned (Storm pieces) lets a sliding piece continue from an allied square in a new direction once per move (queen twice), never stopping on the ally; attacks and checks follow the same paths; Squall returns to neutral when it ships

Status: binding under D-37 (designer may overrule).
Spec: 5.8, 6.1, R-ELEM-006

## Decision

Electric Slide is Storm's signature with a base/attuned split: base (any army) lets a pawn move straight over one adjacent allied piece to the empty square beyond; attuned (Storm pieces) lets a sliding piece continue from an allied square in a new direction once per move (queen twice), never stopping on the ally; attacks and checks follow the same paths; Squall returns to neutral when it ships.

## Why it is the best case

The designer tagged it [storm]; the split keeps the signature usable off-element like every other signature while the dramatic redirects stay Storm's; checks following the paths matches Flow (R-ELEM-006).

## Amendment (Phase 4 build, 2026-10-06)

Built details: a turn leaves the ally's square along any ray of the piece's geometry except the one
it arrived on and its reverse (continuing straight is Flow's privilege, going back adds nothing); a
turned capture approaches its victim from the last corner, which is the direction Block Path judges
(DD-99); the leap is a plain pawn move that never grants en passant (the jumped square is occupied)
and promotes on the last rank; the Attunement Charm set to Storm attunes it on any army, and the
first observed turn then reveals the charm with the ability (8.2). Attack detection walks the same
paths backwards from the target, so pins and checks through turns are exact.
