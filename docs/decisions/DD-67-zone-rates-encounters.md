# DD-67: Zone rate limits and encounters: zone messages other than steps (8/s) and chat (1/s, burst 5) share a 5/s, burst-10 budget like battle messages; an invalid frame costs a token and is a strike; a dropped step answers zpos (the authoritative position) and other drops answer err once per run

Status: binding under D-37 (designer may overrule).
Spec: 10.1, 10.2, R-SEC-005, R-WORLD-002

## Decision

Zone rate limits and encounters: zone messages other than steps (8/s) and chat (1/s, burst 5) share a 5/s, burst-10 budget like battle messages; an invalid frame costs a token and is a strike; a dropped step answers zpos (the authoritative position) and other drops answer err once per run. The encounter grace counts wild-tile steps only. A wild creature's level is uniform over the entry's range intersected with the player's level plus or minus 2, else the nearest level within 2 of the player.

## Why it is the best case

R-SEC-005 with one budget per kind of traffic; the client always learns the true position after a drop (R-SEC-002); the grace protects the first steps into grass rather than any steps; wild levels stay near the player's level as 10.2 describes.
