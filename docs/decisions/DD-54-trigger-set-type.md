# DD-54: Triggers are attributed to the piece type whose set they came from when collected: if the bearer promotes mid-chain (a bonus move), its remaining pawn-set triggers are still named, revealed, veiled and counted on the pawn type

Status: binding under D-37 (designer may overrule).
Spec: 8.2, R-INFO-002, R-RULES-002, DD-28

## Decision

Triggers are attributed to the piece type whose set they came from when collected: if the bearer promotes mid-chain (a bonus move), its remaining pawn-set triggers are still named, revealed, veiled and counted on the pawn type.

## Why it is the best case

8.2 ties knowledge to the piece type an ability was seen on; attributing pawn-set triggers to the queen bypassed Veil and corrupted the reveal log and Dossier (review finding 13).
