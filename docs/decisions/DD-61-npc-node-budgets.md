# DD-61: Server NPCs search with node budgets, never time: Wild 4,000, Trainer 20,000, Elite 12,000 nodes (about 8, 13 and 40 ms mean on a 2

Status: binding under D-37 (designer may overrule).
Spec: 9.4, R-FMT-005

## Decision

Server NPCs search with node budgets, never time: Wild 4,000, Trainer 20,000, Elite 12,000 nodes (about 8, 13 and 40 ms mean on a 2.8 GHz core); the first iteration always completes. If an NPC reply is refused, it falls back to its default option or another legal move; with nothing playable it resigns and the error is logged.

## Why it is the best case

Workers do not advance Date.now during pure CPU work, so time budgets cannot bound server search; node budgets are deterministic and close to the 50 ms target of 9.4.
