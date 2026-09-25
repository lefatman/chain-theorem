# DD-95: M7 world and balance tooling: Highcairn Pass (snow, scree, frost-grass) hangs off Thistle Meadow's west edge with Storm, Stone and Frost wild encounters (rate 0

Status: binding under D-37 (designer may overrule).
Spec: 10.1, 17.2, R-TEST-002, R-WORLD-002

## Decision

M7 world and balance tooling: Highcairn Pass (snow, scree, frost-grass) hangs off Thistle Meadow's west edge with Storm, Stone and Frost wild encounters (rate 0.1, grace 5, levels 5-9), trainers Stormcaller Imre, Mason Hedda, Rimeguard Osk and practice Cragwalker Bev, and quests highcairn_climb (needs academy_first_road) and highcairn_trial (win with Storm abilities only); the Academy is unchanged. The simulator plays every element pair in both colours (removing a false 60-62% white score) and gains --elements; the NPC sweep test's random opponent no longer makes moves that leave its own king in check (the root cause of early endings with the new content; its assertions are unchanged). Balance targets still missed after M7 (advantaged element 64% First Blood and 73% Full Battle against 55-60%; Tide and Grove kits beat the new elements across triangles; First Blood surprise losses; Focused builds) are left to the designer with five questions in docs/BALANCE_M7.md; silenceScope stays ALL_TRIGGERS because REACTIONS_ONLY flips Frost over Stone the wrong way.

## Why it is the best case

PLAYTEST values are tuned only with evidence and never COMMITTED rules; the designer decides kit-level changes (Playtest Gate 1 question 2).
