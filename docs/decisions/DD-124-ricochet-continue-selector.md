# DD-124: Ricochet (plan item C6; designer brief 2026-10-09) ships as Captures, neutral, eligible on bishops, rooks and queens, level 8, one slot, two charges: after capturing, the piece moves one square past the capture square in the direction of its move, if that square is empty

Status: binding under D-37 (designer may overrule).
Spec: 5.2, 5.4, 5.7, R-ABIL-002, R-ELEM-005, DD-111, plan item C6

## Decision

Ricochet (plan item C6; designer brief 2026-10-09) ships as Captures, neutral, eligible on bishops, rooks and queens, level 8, one slot, two charges: after capturing, the piece moves one square past the capture square in the direction of its move, if that square is empty. The destination is a new square selector primitive, CONTINUE ({ s: 'continue' }, square.continue()): the square one step beyond the capture square along the line from the square the captor moved from, defined only when that line is one the moved piece slides on (a rank or file for a rook, a diagonal for a bishop, either for a queen); otherwise, or when the step leaves the board, the move fizzles no_target. An occupied square fizzles occupied, a burning one burning and an uncovered own king inv03, as for every MOVE; a fizzle spends no charge (DD-17). A capture made through an Electric Slide turn continues only when its origin and landing lie on a line the piece slides on, because a move is recorded as origin and landing and the path of a turned capture is not stored.

## Why it is the best case

The brief names the selector and the brakes (charges, INV-03, burning and occupied squares); a one-step continuation along the move's own line is the reading that needs no new state, gives Hot Foot its synergy (leaving the capture square ignites it, R-ELEM-005) and is fully determined by data the engine already keeps. Turned paths: a turned capture whose ends happen to lie on a slider line is indistinguishable from a straight one, so the rule is stated on the line between the two squares rather than on the path; a bishop whose ends lie on a file, or a rook whose ends lie on a diagonal, has no such line and stays, the conservative outcome. The existing MOVE pipeline supplies the INV-03, Hot Foot and occupancy checks and the charge accounting, so the selector is the whole engine change.
