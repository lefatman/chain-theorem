# DD-110: Electric Slide's attuned turn ships in its most balanced measured version: only bishops turn, once per move, at an allied bishop, rook, queen or king (never at a pawn or a knight); rooks and the queen never turn; the base pawn leap is unchanged

Status: superseded the same day by the designer's own rule (DD-111): rooks and bishops turn once at an ally of equal or higher rank, the queen twice at rooks and bishops, never at the king or a pawn.
Spec: 5.7, 5.8, 6.3, R-ELEM-003, R-RULES-001, R-TEST-002, DD-104, DD-106

## Decision

Electric Slide's attuned turn ships in its most balanced measured version: only bishops turn, once per move, at an allied bishop, rook, queen or king (never at a pawn or a knight); rooks and the queen never turn; the base pawn leap is unchanged. The rule is a PLAYTEST config knob (CAPS.ELECTRIC_SLIDE: turning piece types and the corner rule), read by the module and overridden by the simulator's and fuzzer's --caps for variant runs.

## Why it is the best case

Designer answer 2026-10-09: ship the most balanced version of Storm's signature. Ten variants were measured in the mirror test (docs/BALANCE_BASELINE.md section 9, 120 and 80 games, finalists 300 and 200): bishop lines through a developed knight decide First Blood (bishops at any piece 88%, at pieces that have moved 88%), rook turns decide Full Battle (68-70% whichever corners), and the leap alone already reads 57% in both formats; bishops at the other pieces are the only turning rule that adds no First Blood edge over the leap (58%) while keeping a moderate Full Battle bonus (64%), the band the other signatures sit in (42-51% and 52-77%). Rooks at non-knights (57% and 69%) were within noise in First Blood but six points stronger in Full Battle. DD-106's queen exclusion stands; the designer may prefer another rule, which is one config line.
