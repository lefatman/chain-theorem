# DD-68: World challenges: slot bracket = ceil(unlocked item slots / 2) (1-2, 3-4, 5-6)

Status: binding under D-37 (designer may overrule).
Spec: 9.3, 10.4, R-WORLD-004, R-WORLD-006

## Decision

World challenges: slot bracket = ceil(unlocked item slots / 2) (1-2, 3-4, 5-6). A challenge starts at once only when both players stand inside a challenge zone in the same bracket and neither is in the 60 s cooldown that follows any battle; otherwise it becomes a consent challenge. Consent challenges: one open per challenger, at most 5 pending per target, lapse after 60 s or on leave or warp; a decline tells the challenger.

## Why it is the best case

Matches the 9.3 brackets (DD-04) and R-WORLD-006 without ever forcing a battle outside a challenge zone; the caps stop challenge spam (R-SEC-005).
