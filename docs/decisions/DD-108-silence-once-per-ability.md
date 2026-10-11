# DD-108: silenceScope gains ONCE_PER_ABILITY (6.2, PLAYTEST knob, default unchanged at ALL_TRIGGERS): the foil silences each ability on each piece type once per battle, the first time, which reveals it as any silence does; from then on that ability fires against the foil like any other

Status: binding under D-37 (designer may overrule). Amended by DD-122 (B5, 2026-10-11): Resonance Crystal spares one silence under every scope; the "never" reading was withdrawn after section 8 of docs/BALANCE_BASELINE.md.
Spec: 6.2, 7.2, 17.2, R-ELEM-002, R-LOAD-002, R-SEC-001, DD-30, DD-98

## Decision

silenceScope gains ONCE_PER_ABILITY (6.2, PLAYTEST knob, default unchanged at ALL_TRIGGERS): the foil silences each ability on each piece type once per battle, the first time, which reveals it as any silence does; from then on that ability fires against the foil like any other. The record of silenced piece-type/ability pairs is engine state (hashed like usage counters, kept through a rewind like charges) and is projected only where the viewer knows the ability, so a Veiled silence stays private. Under this scope Resonance Crystal means never: every silence of its owner's pieces is spared and the Crystal is revealed the first time it spares one. The simulator gains --prefer to deal named cards ahead of their category so Capturing cards with effects (Pierce) are in the builds the silence runs use.

## Why it is the best case

The DD-98 and B1 balance runs found the silence rule deciding long games (advantaged element 73-90% in Full Battle against a 55-60% target) and the REACTIONS_ONLY knob inert with Scout as the only Capturing card; a once-per-ability silence keeps the foil's first strike and the reveal it buys while letting a disadvantaged army fight on, which fits the pillar that skill decides most games; identities in 6.2 stay COMMITTED, only the scope is tunable; the Crystal's reading follows from its text (the first silence does not happen) applied to a rule under which each ability has one.
