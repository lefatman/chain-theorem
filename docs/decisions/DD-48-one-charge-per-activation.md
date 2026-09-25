# DD-48: An activation spends at most one charge, even when both an immediate effect and an fx

Status: binding under D-37 (designer may overrule).
Spec: 5.6, DD-17

## Decision

An activation spends at most one charge, even when both an immediate effect and an fx.atChainEnd effect of the same activation resolve.

## Why it is the best case

5.6 counts charges per activation; DD-17 spends a charge when at least one effect resolves, not one per effect.
