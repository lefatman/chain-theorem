# DD-10: Battle events add BattleStarted, ActionStarted, PieceMoved (effect move), PieceRevived, Promoted, ChoiceMade and TurnPassed to the event types named in 13

Status: binding under D-37 (designer may overrule).
Spec: 13.2, R-DATA-002

## Decision

Battle events add BattleStarted, ActionStarted, PieceMoved (effect move), PieceRevived, Promoted, ChoiceMade and TurnPassed to the event types named in 13.2.

## Why it is the best case

The client needs a typed record for every visible step to animate, log and replay chains (11.2); these are board changes the named types do not cover.
