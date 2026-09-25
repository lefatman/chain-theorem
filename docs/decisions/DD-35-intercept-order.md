# DD-35: Effect intercepts run in this order: Royal Immunity, INV-03, trait hooks (Bulwark, Hot Foot), item hooks, ability hooks, then PROTECT registrations (Antidote)

Status: binding under D-37 (designer may overrule).
Spec: 13.5, 4.4, INV-03

## Decision

Effect intercepts run in this order: Royal Immunity, INV-03, trait hooks (Bulwark, Hot Foot), item hooks, ability hooks, then PROTECT registrations (Antidote). The first fizzle wins and later interceptors are not consumed, so Bulwark is spent before Antidote.

## Why it is the best case

Follows the fixed hook order of 13.5 (invariants, traits, items, abilities).
