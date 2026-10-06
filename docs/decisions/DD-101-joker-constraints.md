# DD-101: Schrödinger's Joker constraints: the twin starts on the captor's own square and moves out with its own move right after the owner's normal move each turn; a twin group is capped at three pieces; capturing or effect-capturing any member removes the group; shipped behind a PLAYTEST flag after a 100,000-game fuzz proves turns and chains terminate

Status: binding under D-37 (designer may overrule).
Spec: 5.8, INV-01, INV-04

## Decision

Schrödinger's Joker constraints: the twin starts on the captor's own square and moves out with its own move right after the owner's normal move each turn; a twin group is capped at three pieces; capturing or effect-capturing any member removes the group; shipped behind a PLAYTEST flag after a 100,000-game fuzz proves turns and chains terminate.

## Why it is the best case

Designer answer 5; the cap bounds the tempo gain (INV-01 is about bonus actions inside an action, so a per-turn twin move is a new turn structure and needs its own bound).
