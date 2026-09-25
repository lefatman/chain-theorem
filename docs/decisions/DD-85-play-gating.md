# DD-85: Play gating after the trial: expired accounts can sign in, see their account, export or delete data and subscribe; the world ticket, NPC and challenge battles, challenge acceptance, the queue ticket and the zone and queue socket upgrades answer 402 subscription_required; a battle already in progress can be finished (rejoin tickets and battle sockets are not gated); an open zone connection is refused at its next reconnect; any 402 makes the client re-read /api/me so every screen shows the trial-ended state

Status: binding under D-37 (designer may overrule).
Spec: 14.4, R-COST-005

## Decision

Play gating after the trial: expired accounts can sign in, see their account, export or delete data and subscribe; the world ticket, NPC and challenge battles, challenge acceptance, the queue ticket and the zone and queue socket upgrades answer 402 subscription_required; a battle already in progress can be finished (rejoin tickets and battle sockets are not gated); an open zone connection is refused at its next reconnect; any 402 makes the client re-read /api/me so every screen shows the trial-ended state.

## Why it is the best case

Fairness to the opponent of a battle in progress, no timers in the rooms, and one consistent client state.
