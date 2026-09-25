# DD-13: Loadout-shaping items declare data the validator reads: capacity (capacity items), grants

Status: binding under D-37 (designer may overrule).
Spec: 7.4, 13.5

## Decision

Loadout-shaping items declare data the validator reads: capacity (capacity items), grants.perTypeSets (Multitasker's Schedule) and grants.secondElement (Blended Family); items needing a choice declare param.element (Attunement Charm, Masquerade Mask).

## Why it is the best case

R-LOAD-004 requires every limit to come from CAPS and module data; flags keep the validator free of item ids.
