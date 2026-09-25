# DD-64: New accounts start at level 1 owning every level-1 module (Dual Adept's Glove, Hit and Run, Last Word, Scout), enough for a legal level-1 loadout; NPC loadouts are built from content data per tier and level (packages/content/src/npcs

Status: binding under D-37 (designer may overrule).
Spec: 7.5, 9.4, R-LOAD-004, R-FMT-005

## Decision

New accounts start at level 1 owning every level-1 module (Dual Adept's Glove, Hit and Run, Last Word, Scout), enough for a legal level-1 loadout; NPC loadouts are built from content data per tier and level (packages/content/src/npcs.ts, Wild 1-2 abilities, Trainer themed, Elite with utility items), validated at the NPC's level, falling back to off-affinity abilities at low levels as players must.

## Why it is the best case

Online play needs owned modules (R-LOAD-004 rule 7) before M5 rewards exist; content-data NPCs follow the same rules as players (9.4).
