# DD-25: Settle order: update the 50-move counter, pass the turn and run onTurnEnd (Hot Foot countdown) first, then adjudicate in precedence order: royal defeats (Stalwart capture, checkmate; both sides = draw), format objective, stalemate, 50-move rule, threefold repetition

Status: binding under D-37 (designer may overrule).
Spec: 5.3, 4.5, 9.1

## Decision

Settle order: update the 50-move counter, pass the turn and run onTurnEnd (Hot Foot countdown) first, then adjudicate in precedence order: royal defeats (Stalwart capture, checkmate; both sides = draw), format objective, stalemate, 50-move rule, threefold repetition.

## Why it is the best case

Mate and stalemate are judged on the exact position the next player faces; royal defeat outranks objectives (R-FMT-002).
