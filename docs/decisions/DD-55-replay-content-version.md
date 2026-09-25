# DD-55: A replay is shown from its recorded event log and final state hash; re-simulation is used to verify only battles whose recorded content version matches the running registry

Status: binding under D-37 (designer may overrule).
Spec: 13.5, R-TEST-001

## Decision

A replay is shown from its recorded event log and final state hash; re-simulation is used to verify only battles whose recorded content version matches the running registry. Older battles stay viewable but are marked as not re-verifiable.

## Why it is the best case

13.5 wants replays of the same module versions; keeping every past registry in the bundle is heavy, while the event log is already self-contained for display (DD-10).
