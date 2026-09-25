# DD-31: Bonus moves are real chess moves: they update castling rights, the en passant square and the 50-move counter, and a pawn reaching the last rank promotes (each promotion piece is a separate option)

Status: binding under D-37 (designer may overrule).
Spec: INV-01, 4.2

## Decision

Bonus moves are real chess moves: they update castling rights, the en passant square and the 50-move counter, and a pawn reaching the last rank promotes (each promotion piece is a separate option). Castling is never a bonus move.

## Why it is the best case

Keeps the board state consistent with FIDE rules after every move.
