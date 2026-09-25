# DD-47: King safety for INV-03 is judged against the movement rules as they will stand after the turn ends (onTurnEnd applied to a draft): a move is illegal if the mover's ordinary king would be in check once an expiring Hot Foot burn goes out

Status: binding under D-37 (designer may overrule).
Spec: INV-03, DD-25, R-ELEM-005, R-ELEM-006

## Decision

King safety for INV-03 is judged against the movement rules as they will stand after the turn ends (onTurnEnd applied to a draft): a move is illegal if the mover's ordinary king would be in check once an expiring Hot Foot burn goes out. Simulations for revive, effect moves and bonus moves recompute Flow and Hot Foot rules on a draft that includes the change (a revived Tide rook or a promotion to a Tide queen brings Flow).

## Why it is the best case

INV-03 outranks DD-25's ordering: the countdown ran after legality, so a burn expiring at the end of the mover's own turn could leave that player's king in check (review findings 1, 2, 3).
