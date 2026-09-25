# DD-23: The engine accepts the element 'neutral' for test and sandbox battles (worked examples say 'neutral elements'); real loadouts must use CAPS

Status: binding under D-37 (designer may overrule).
Spec: 5.5, 6.1

## Decision

The engine accepts the element 'neutral' for test and sandbox battles (worked examples say 'neutral elements'); real loadouts must use CAPS.ENABLED_ELEMENTS, enforced by validateLoadout.

## Why it is the best case

The golden examples need element-free armies, while players always field one of the six elements.
