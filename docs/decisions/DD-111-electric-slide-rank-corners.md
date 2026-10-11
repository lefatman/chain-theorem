# DD-111: Electric Slide's attuned turn follows the designer's rule of 2026-10-09: a rook or bishop may change direction once at an allied piece of equal or higher rank than itself (5.1 DD-97: a rook at a rook or queen, a bishop at a knight, bishop, rook or queen), the queen may change direction twice and only at allied rooks and bishops, the king is never a corner and nothing turns at a pawn; a slider never stops on the ally or continues straight or back, and attacks follow the same paths

Status: binding under D-37 (designer may overrule).
Spec: 5.1, 5.7, 5.8, 6.3, R-ELEM-003, R-RULES-001, R-ELEM-006, DD-97, DD-104, DD-106, DD-110

## Decision

Electric Slide's attuned turn follows the designer's rule of 2026-10-09: a rook or bishop may change direction once at an allied piece of equal or higher rank than itself (5.1 DD-97: a rook at a rook or queen, a bishop at a knight, bishop, rook or queen), the queen may change direction twice and only at allied rooks and bishops, the king is never a corner and nothing turns at a pawn; a slider never stops on the ally or continues straight or back, and attacks follow the same paths. The engine's corner flag is now per slider type (redirectCorner takes the slider type; MoveRules.conducts is a bitmask), so a corner can depend on who is turning. The CAPS.ELECTRIC_SLIDE knob of DD-110 is removed; the rule is content.

## Why it is the best case

The designer stated the rule in full after seeing the DD-106 and DD-110 measurements, so it ships as given; the rank comparison reuses the DD-97 order and treats the knight/bishop tie as equal, as that decision says. The queen's rooks-and-bishops corners and two turns, and the king's exclusion, are the designer's words; the pawn leap of the base version is untouched.
