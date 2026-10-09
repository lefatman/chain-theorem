# DD-105: A pending prompt is shown to the chooser's opponent and to spectators only when the prompting ability is already known to them on that piece type; otherwise they see no pending choice (the chooser's clock keeps running as if they were thinking) and the ChoiceMade and FacingSet events of an unrevealed ability are theirs alone

Status: binding under D-37 (designer may overrule).
Spec: 8.2, 8.5, R-SEC-001, R-INFO-005

## Decision

A pending prompt is shown to the chooser's opponent and to spectators only when the prompting ability is already known to them on that piece type; otherwise they see no pending choice (the chooser's clock keeps running as if they were thinking) and the ChoiceMade and FacingSet events of an unrevealed ability are theirs alone. Pending prompts of known abilities show the chooser as before (8.5).

## Why it is the best case

Block Path asks its owner a facing question after every move of the piece; showing that a choice is pending would announce an unrevealed passive on every quiet move, against 8.2 and R-SEC-001. Capture-triggered prompts are unaffected because their ability is revealed as 'activated' before the prompt opens.
