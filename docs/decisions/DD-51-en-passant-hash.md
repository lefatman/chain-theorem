# DD-51: The repetition hash includes the en passant file only when a legal en passant capture exists for the side to move (pins, burning squares and Stalwart rules included)

Status: binding under D-37 (designer may overrule).
Spec: R-RULES-003, FIDE 9.2

## Decision

The repetition hash includes the en passant file only when a legal en passant capture exists for the side to move (pins, burning squares and Stalwart rules included).

## Why it is the best case

FIDE 9.2.3: positions are the same when the same moves are possible; a pseudo-legal en passant right that cannot be used must not prevent a threefold repetition claim (review findings 10, 21).
