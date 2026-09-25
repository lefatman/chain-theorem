# DD-41: Cleave (and any effect filter anchored on 'landing') is measured from the square the captor captured on, even when an earlier trigger (Hit and Run, Momentum) has moved the captor away

Status: binding under D-37 (designer may overrule).
Spec: 5.7, R-ABIL-004

## Decision

Cleave (and any effect filter anchored on 'landing') is measured from the square the captor captured on, even when an earlier trigger (Hit and Run, Momentum) has moved the captor away. The SDK anchor 'landing' names that square; 'captor' still means the captor's current square.

## Why it is the best case

The spec text says 'diagonally adjacent to the square it captured on'; measuring from wherever the captor ended up made Cleave depend on loadout order and hit pieces the spec never targets (review finding 4).
