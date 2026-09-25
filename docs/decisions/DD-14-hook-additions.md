# DD-14: Hook set additions: silenceOverride (Resonance Crystal), modifyCharges (Overabundance), attunement (Attunement Charm) and onEvent (Masquerade Mask, Hot Foot bookkeeping)

Status: binding under D-37 (designer may overrule).
Spec: 13.5

## Decision

Hook set additions: silenceOverride (Resonance Crystal), modifyCharges (Overabundance), attunement (Attunement Charm) and onEvent (Masquerade Mask, Hot Foot bookkeeping). moveFilter is split into passThrough (Flow), blockedSquares (Hot Foot) and kingMode (Stalwart), each called once per piece rather than per square.

## Why it is the best case

These items and traits cannot be expressed with the listed hooks without item ids in the engine; per-piece movement hooks keep move generation fast enough for search and fuzzing.
