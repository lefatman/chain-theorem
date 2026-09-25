# DD-34: Zobrist keys come from xoshiro128** with a fixed seed; the non-board part of the state is folded in with a 64-bit FNV-1a hash of canonical JSON

Status: binding under D-37 (designer may overrule).
Spec: 13.2

## Decision

Zobrist keys come from xoshiro128** with a fixed seed; the non-board part of the state is folded in with a 64-bit FNV-1a hash of canonical JSON.

## Why it is the best case

Deterministic across builds and platforms with no runtime dependency (INV-04).
