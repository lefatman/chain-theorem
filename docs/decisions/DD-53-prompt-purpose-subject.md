# DD-53: ChoiceRequest carries two optional fields: purpose on target prompts (capture, move, revive or protect) and subject on square prompts (the piece that will be placed)

Status: binding under D-37 (designer may overrule).
Spec: 5.4, R-FMT-005, DD-10

## Decision

ChoiceRequest carries two optional fields: purpose on target prompts (capture, move, revive or protect) and subject on square prompts (the piece that will be placed). Both are known to the chooser, who owns the ability.

## Why it is the best case

The client can highlight the right piece and the NPC can score a protect or a push correctly; without them the NPC treated every chosen piece as harmed and every square as the bearer's.
