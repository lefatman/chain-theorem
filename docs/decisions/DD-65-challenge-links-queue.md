# DD-65: Challenge links: the battle id is c-<code> with a 10-character random code; the BattleRoom holds a lobby with the creator until someone else accepts, then assigns colours at random and starts; the creator waits inside the battle (their socket is restarted when it starts)

Status: binding under D-37 (designer may overrule).
Spec: 9.3, R-FMT-004

## Decision

Challenge links: the battle id is c-<code> with a 10-character random code; the BattleRoom holds a lobby with the creator until someone else accepts, then assigns colours at random and starts; the creator waits inside the battle (their socket is restarted when it starts). Casual queue windows widen by one level every 10 s after 30 s of waiting, and a pair needs both players' windows.

## Why it is the best case

A code addresses its room directly (no lookup table); widening keeps small populations playable while nobody is matched outside the range they have waited for (9.3).
