# DD-40: Scout's attuned reveal picks the highest-cost item with ties broken by item id and fizzles when the opponent has no items; Last Word's attuned reveal discloses the complete item list, including that it is empty

Status: binding under D-37 (designer may overrule).
Spec: 5.7

## Decision

Scout's attuned reveal picks the highest-cost item with ties broken by item id and fizzles when the opponent has no items; Last Word's attuned reveal discloses the complete item list, including that it is empty.

## Why it is the best case

Deterministic tie-break; an empty list is itself useful information.
