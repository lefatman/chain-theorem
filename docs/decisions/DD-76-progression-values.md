# DD-76: Progression values (PLAYTEST, in packages/content/world/progression

Status: binding under D-37 (designer may overrule).
Spec: 7.5, 10.2, R-LOAD-005, R-SEC-003

## Decision

Progression values (PLAYTEST, in packages/content/world/progression.ts): XP from level L to L+1 is round(60 x L^1.6), cap 30; battle XP win/draw/loss First Blood 30/15/10, Vanguard 70/35/20, Full 120/60/35, times 1 + 0.15 x (opponent level - 1); 25 XP for a first visit to a zone; wild rewards seeded from the battle id: coins 4-10 on a win, 2-4 on a draw, 1-2 on a loss, and a 10% chance on a win of a card of the army's element usable now. Battles with fewer than 2 plies grant no battle reward.

## Why it is the best case

Losses still pay (pillar 5); longer formats pay more per battle but not per minute; the Academy reaches level 3 and the road quest level 4; seeded drops make every grant reproducible and idempotent (R-SEC-003); the ply floor stops instant-resign farming.
