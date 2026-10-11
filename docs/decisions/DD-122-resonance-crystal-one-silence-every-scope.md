# DD-122: Resonance Crystal spares exactly the first silence of its owner's pieces this battle under every `silenceScope`, `ONCE_PER_ABILITY` included (packages/content/items/resonance_crystal.ts, version 3; the ONCE_PER_ABILITY branch is removed and the text is back to "The first time one of your pieces would be silenced this battle, it is not")

Status: binding under D-37 (designer may overrule).
Spec: 6.2, 7.2, R-LOAD-002, R-ELEM-002, DD-30, DD-108

## Decision

Resonance Crystal spares exactly the first silence of its owner's pieces this battle under every `silenceScope`, `ONCE_PER_ABILITY` included (packages/content/items/resonance_crystal.ts, version 3; the ONCE_PER_ABILITY branch is removed and the text is back to "The first time one of your pieces would be silenced this battle, it is not"). This retires the reading DD-108 attached to the scope ("the Crystal then means never"); DD-108's scope itself, its public record and the per-piece-per-capture scope of DD-30 are unchanged. The engine needed no change: filterTrigger (packages/rules/src/engine/action.ts) consults silenceOverride before it writes the once-per-ability record, so the spared ability still has its one silence to come, which resonance_crystal.test.ts pins (spared, then silenced with the record naming knight:scout, then firing).

## Why it is the best case

Section 8 of docs/BALANCE_BASELINE.md made the Crystal the condition on the scope the data favours: with the Crystal in every Focused build, `ONCE_PER_ABILITY` read 44.4% advantaged element in Full Battle, "a measurement of no silence at all" in which Tide beat every element at 60-100% and Storm lost 0-13% to four (finding 3); with the Crystal left out (`--without resonance_crystal`) the same scope read 61.7% against `ALL_TRIGGERS`' 71.4%, the closest any scope came to the 55-60% target, and 53.5% against 55.2% in First Blood. Under `ALL_TRIGGERS` the one-silence Crystal trims the foil's edge by five points (71.4% to 66.7%), "the job its text describes". Finding 4 therefore set the B5 condition that the Crystal "must not mean never" (one spared silence as DD-30 had it, or a higher slot cost for never); one spared silence keeps a 1-slot level-6 item at its text and lets the scope be shipped later without the item switching it off for anyone who equips it. The designer's B5 brief adopts it (section 11, "the B3 condition").
