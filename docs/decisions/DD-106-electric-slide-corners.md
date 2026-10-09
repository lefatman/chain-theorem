# DD-106: Electric Slide's attuned turn happens only at an allied piece other than a pawn: a pawn in a slider's path blocks it as in chess, while knights, bishops, rooks, the queen and the king remain corners (new moveFilter hook redirectCorner, engine flag MoveRules

Status: binding under D-37 (designer may overrule).
Spec: 5.8, 6.3, R-ELEM-003, R-RULES-001, R-ELEM-006, DD-104, 17.2

## Decision

Electric Slide's attuned turn happens only at an allied piece other than a pawn: a pawn in a slider's path blocks it as in chess, while knights, bishops, rooks, the queen and the king remain corners (new moveFilter hook redirectCorner, engine flag MoveRules.conducts; the pawn leap of the base version is unchanged). The alternative of turning only at allies that have left their starting square was rejected because one pawn push restores the opening trap a move later.

## Why it is the best case

With pawns as corners the opening pawn wall was a launch pad: the c1 bishop turned at b2 and took g7 on move 1, the queen reached seven pawns from d1, and any developed knight fell on move 2 (Bc1-b2-f6, Bf1-g2-c6), a forced First Blood win measured at 97-100% for Storm against four elements and 100% in the card mirror test (docs/BALANCE_BASELINE.md finding 1); of Black's 40 replies to 1.a3 only the 12 pawn moves on six files survived. Turning at pieces keeps the card's identity (sliders bend their paths around their fellow pieces, checks follow) and the 17.2 pillar that skill decides most games. Electric Slide is PLAYTEST from the 2026-10-06 designer brief; the designer may prefer another corner rule.
