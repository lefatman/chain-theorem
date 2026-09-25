# DD-57: Online clocks: the side to move's clock starts when the BattleRoom is created; the Fischer increment is added when the mover's action completes (also through a prompt answer or timeout) and never after the battle ends; the flag falls at remaining ≤ 0; at equal times flag fall precedes a prompt default, which precedes grace expiry

Status: binding under D-37 (designer may overrule).
Spec: 9.2, R-FMT-003

## Decision

Online clocks: the side to move's clock starts when the BattleRoom is created; the Fischer increment is added when the mover's action completes (also through a prompt answer or timeout) and never after the battle ends; the flag falls at remaining ≤ 0; at equal times flag fall precedes a prompt default, which precedes grace expiry. NPC clocks never run. A human seat that never connects abandons when the 60 s grace from creation ends.

## Why it is the best case

Server-owned timestamps with one deterministic order of deadlines make every result reproducible from the log (9.2, R-FMT-003).
