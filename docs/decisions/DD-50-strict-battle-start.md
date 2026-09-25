# DD-50: newBattle validates both loadouts with R-LOAD-004 when BattleSetup

Status: binding under D-37 (designer may overrule).
Spec: R-LOAD-004, DD-23

## Decision

newBattle validates both loadouts with R-LOAD-004 when BattleSetup.strict is set and throws on any error; every real battle sets it (server, local play, NPC, simulator, fuzzer). Tests and the Scenario Lab sandbox leave it off. validateLoadout rejects a level that is not an integer in 1..LEVEL_CAP (code bad_level, rule 2).

## Why it is the best case

R-LOAD-004 is an invariant at battle start; a caller that forgot to validate, or a malformed level, could start an illegal battle and break Dossier deduction (review findings 18, 19).
