# DD-12: INV-01 says bonus actions cannot grant further bonus actions, so every BONUS_ACTION effect inside a bonus action fizzles (reason bonus_in_bonus)

Status: binding under D-37 (designer may overrule).
Spec: 4.1 INV-01, 5.3

## Decision

INV-01 says bonus actions cannot grant further bonus actions, so every BONUS_ACTION effect inside a bonus action fizzles (reason bonus_in_bonus). The effective nesting depth is therefore 1; CAPS.MAX_CHAIN_DEPTH (3) stays as a hard guard.

## Why it is the best case

INV-01 outranks the tunable depth; keeping the guard protects against future primitives that could recurse.
