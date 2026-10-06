# DD-101: Schrödinger's Joker constraints: the twin starts on the captor's own square and moves out with its own move right after the owner's normal move each turn; a twin group is capped at three pieces; capturing or effect-capturing any member removes the group; shipped behind a PLAYTEST flag after a 100,000-game fuzz proves turns and chains terminate

Status: binding under D-37 (designer may overrule).
Spec: 5.8, INV-01, INV-04

## Decision

Schrödinger's Joker constraints: the twin starts on the captor's own square and moves out with its own move right after the owner's normal move each turn; a twin group is capped at three pieces; capturing or effect-capturing any member removes the group; shipped behind a PLAYTEST flag after a 100,000-game fuzz proves turns and chains terminate.

## Why it is the best case

Designer answer 5; the cap bounds the tempo gain (INV-01 is about bonus actions inside an action, so a per-turn twin move is a new turn structure and needs its own bound).

## Amendment (Phase 6 build, 2026-10-06)

Built details: a spawned twin is a new piece id (32 onwards) that waits off the board with a
`spawnSquare` until its owner's next turn; after the owner's normal move and its chain, every twin
of theirs is offered its own move (declinable): one on the board moves from where it stands, a
waiting one steps onto an empty spawn square and then moves, and when the original still stands on
the spawn square the two are one piece in two places, so the original moves out and the twin takes
the square. Twins spawned during the action wait for the next turn. Linked fate removes every other
member as an effect capture by the rule `linked_fate` (waiting twins with `waiting: true`), credited
to the capturing side. A twin's own capture of a higher-rank piece spends its own charge. The ability
is non-king. Waiting twins and groups are part of the repetition hash; a rewind restores them. The
PLAYTEST flag is on after the fuzz runs recorded in PROGRESS.md; the 100,000-game run stays on the
release checklist (17.3) because it takes hours on this hardware.
