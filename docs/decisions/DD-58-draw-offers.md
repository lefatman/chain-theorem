# DD-58: Draw offers: 'one per 10 moves' is 20 plies since that side's last offer; an offer lapses at the next action; offering while the opponent's offer is open agrees; a declined offer is announced to both sides (drawDeclined); an NPC accepts only when its evaluation of its own belief state is ≤ −150 centipawns

Status: binding under D-37 (designer may overrule).
Spec: 9.2, 9.4

## Decision

Draw offers: 'one per 10 moves' is 20 plies since that side's last offer; an offer lapses at the next action; offering while the opponent's offer is open agrees; a declined offer is announced to both sides (drawDeclined); an NPC accepts only when its evaluation of its own belief state is ≤ −150 centipawns.

## Why it is the best case

Implements 9.2 conduct rules unambiguously and gives NPCs a conservative, projection-only draw policy (9.4).
