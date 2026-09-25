# DD-33: Threefold repetition hashes the full engine state: piece identities with type, element and square, side to move, castling rights, the en passant file only when a pawn could capture en passant, reveal logs, usage counters and every hashed state slice (burning squares included)

Status: binding under D-37 (designer may overrule).
Spec: 4.5, R-RULES-005

## Decision

Threefold repetition hashes the full engine state: piece identities with type, element and square, side to move, castling rights, the en passant file only when a pawn could capture en passant, reveal logs, usage counters and every hashed state slice (burning squares included).

## Why it is the best case

4.5 defines repetition over the full engine state; identity matters because charges are per piece.
