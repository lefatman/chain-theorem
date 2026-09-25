# DD-46: INV-03 filtering of choice options follows DD-19: when the chooser is not the acting player, the acting player's king counts as Stalwart only if Stalwart is already revealed

Status: binding under D-37 (designer may overrule).
Spec: DD-19, DD-32, R-SEC-001, INV-03

## Decision

INV-03 filtering of choice options follows DD-19: when the chooser is not the acting player, the acting player's king counts as Stalwart only if Stalwart is already revealed. An option that would leave a hidden-Stalwart king in check is not offered to the opponent; the same applies to the Riposte attuned fallback's 'no legal capturer' test. Effects that are not chosen (Poisoned Meat on the captor) use the true state and reveal Stalwart when they resolve (DD-32).

## Why it is the best case

Offering the option, or showing a prompt with one more option, told the opponent the king was Stalwart without any reveal (review findings 6, 12, 16); filtering on public knowledge is the same principle DD-19 applies to hidden protections.
