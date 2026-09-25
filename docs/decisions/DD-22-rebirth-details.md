# DD-22: Rebirth returns the piece, with its current type, to the starting square of that piece identity; its attuned version offers the starting square plus every empty square on its owner's back rank

Status: binding under D-37 (designer may overrule).
Spec: 5.7, 5.4

## Decision

Rebirth returns the piece, with its current type, to the starting square of that piece identity; its attuned version offers the starting square plus every empty square on its owner's back rank. Chain-end effects resolve in the order their triggers resolved.

## Why it is the best case

Piece identity (5.4) is the stable anchor; ordering by resolution keeps chain ends deterministic and readable.
