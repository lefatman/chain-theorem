# DD-128: Herald's Horn (plan item C7; designer brief 2026-10-09) ships as a one-slot, level-7 PLAYTEST item: at battle start it reveals both players' full item lists through the engine's items reveal (cause effect, the Horn as source), the Horn itself included, an empty list as complete; item parameters (the Masquerade Mask's chosen element) are not part of an item list and stay hidden; two Horns reveal once, since host.ts deduplicates reveals

Status: binding under D-37 (designer may overrule).
Spec: 7.2, 8.2, 8.3, R-LOAD-002, R-INFO-002, R-SEC-001, DD-40, plan item C7

## Decision

Herald's Horn (plan item C7; designer brief 2026-10-09) ships as a one-slot, level-7 PLAYTEST item: at battle start it reveals both players' full item lists through the engine's items reveal (cause effect, the Horn as source), the Horn itself included, an empty list as complete; item parameters (the Masquerade Mask's chosen element) are not part of an item list and stay hidden; two Horns reveal once, since host.ts deduplicates reveals. Spec 7.2 updated.

## Why it is the best case

The brief asks for cheap, symmetric information for the surprise-loss metric and a hook for Dossier play; the items reveal already exists (Last Word's retired attuned bonus, DD-40), so the Horn is pure content. Revealing both lists rather than the opponent's alone keeps the item symmetric and cheap, as the brief says, and keeps R-SEC-001 trivially: the projection shows only what the reveal log holds.
