# DD-93: Tournaments: Swiss uses a simplified Dutch system (score groups pair top half against bottom half; a backtracking search avoids repeat pairings and equal colour needs, falling back to a greedy pairing; the bye goes to the lowest-ranked player without one, worth 1 point), tie-breaks points, Buchholz (a bye adds 0), Sonneborn-Berger, seed; ceil(log2 n) + 1 rounds capped at a round robin

Status: binding under D-37 (designer may overrule).
Spec: 10.4, 12.2, R-WORLD-004, R-FMT-004

## Decision

Tournaments: Swiss uses a simplified Dutch system (score groups pair top half against bottom half; a backtracking search avoids repeat pairings and equal colour needs, falling back to a greedy pairing; the bye goes to the lowest-ranked player without one, worth 1 point), tie-breaks points, Buchholz (a bye adds 0), Sonneborn-Berger, seed; ceil(log2 n) + 1 rounds capped at a round robin. Single elimination is seeded by Glicko-2 rating in the event's format and bracket (1500 unrated, then registration order) with byes to the top seeds; a drawn game sends Black through, a double loss sends nobody, places are 1, 2, 3, 3, 5. No-shows use the 60 s battle disconnect grace (a side that sent no frame before an abandonment is absent; both absent is a double loss; one missed game withdraws). Pairings are published 60 s before battles start; battle ids are deterministic (t-<id>-<round>-<board>) so a watchdog can recreate them. Prizes (PLAYTEST) go only to players who played, once per tournament and player, retried by alarm; tournament games pay normal PvP XP and are unrated. Scheduled daily events per bracket are created on first read (unique schedule key); the room is the registration authority (bracket and entitlement checked at registration, suspended or deleted players dropped at start); the tournament page polls.

## Why it is the best case

Deterministic, pure pairing that is easy to test; tie-breaks defined for ties of any size; no cron or sockets needed; spec 12.2 alarms only.
