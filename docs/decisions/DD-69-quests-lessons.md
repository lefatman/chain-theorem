# DD-69: Quests and lessons: one event completes at most one quest step; a current lesson or defeat step already met by the player's record completes at once; a reach step completes on join or when it becomes current while the player stands in the area

Status: binding under D-37 (designer may overrule).
Spec: 10.3, 10.5, R-WORLD-003, R-WORLD-005, R-SEC-003

## Decision

Quests and lessons: one event completes at most one quest step; a current lesson or defeat step already met by the player's record completes at once; a reach step completes on join or when it becomes current while the player stands in the area. A win step's onlyAffinity needs at least one ability used and all of that element; lesson battles never count for win steps and a tier constraint never matches PvP. Skipping a chess lesson completes it and grants its reward once. Puzzle answers are checked with the engine using element-free sandbox loadouts (DD-23) in the full format, so puzzle positions carry both kings.

## Why it is the best case

No quest can stall on a once-only trainer beaten earlier; rewards stay server-decided and once-only (R-SEC-003); a listed answer must also be legal, so a bad puzzle cannot grant a reward for an illegal move.
