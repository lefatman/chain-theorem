# DD-99: Block Path geometry: eight facings (N, NE, E, SE, S, SW, W, NW), north by default; only an attacker approaching along the chosen line is blocked, so a diagonal must be chosen to block that diagonal; knights count along their long leg; kings included, so a king cannot be checked from its blocked facing; effect captures ignore it; the facing is chosen after the piece moves through a declinable prompt and is revealed the first time it changes which captures are legal

Status: binding under D-37 (designer may overrule).
Spec: 5.8, R-ABIL-001

## Decision

Block Path geometry: eight facings (N, NE, E, SE, S, SW, W, NW), north by default; only an attacker approaching along the chosen line is blocked, so a diagonal must be chosen to block that diagonal; knights count along their long leg; kings included, so a king cannot be checked from its blocked facing; effect captures ignore it; the facing is chosen after the piece moves through a declinable prompt and is revealed the first time it changes which captures are legal.

## Why it is the best case

Designer answer 3 (diagonals are directions of their own) plus the delegated details: the long-leg rule gives knights one unambiguous approach, kings are included because the ability text says 'piece', and reveal-on-observation follows Stalwart's rule (DD-32).

## Amendment (Phase 3 build, 2026-10-06)

"North by default" is read as the owner's forward direction: N for White and S for Black in board
terms. An absolute north would guard White's unmoved pieces from frontal attack and Black's from
their own back rank, an asymmetry the 17.2 White-score target does not allow. Facings are the
owner's private state until Block Path is revealed on that piece type (see DD-105 for the prompt);
once revealed, the opponent and spectators see that type's facings, defaults included.
