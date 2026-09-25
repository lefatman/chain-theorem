# DD-11: A suspended action is stored in GameState

Status: binding under D-37 (designer may overrule).
Spec: 5.4, 13.2

## Decision

A suspended action is stored in GameState.pending as the pre-action snapshot, the action input, the ordered choice answers so far, the open ChoiceRequest and a snapshot of the queue; applyAction(state, choice) deterministically re-runs the action from the snapshot with the extended answer list and returns only the new events.

## Why it is the best case

Plain JSON survives a Durable Object restart, and deterministic replay (INV-04) keeps the resolver simple recursive code instead of a hand-written continuation machine, which removes a whole class of resume bugs.
