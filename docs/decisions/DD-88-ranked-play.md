# DD-88: Ranked play: ranked queues exist for Vanguard and Full Battle only, one Matchmaker per format and bracket (bracket from the slots unlocked at the player's level, never the loadout); pairing by Glicko-2 rating with a widening window that both players' windows must allow (PLAYTEST in CAPS

Status: binding under D-37 (designer may overrule).
Spec: 9.3, R-FMT-004, R-SEC-008

## Decision

Ranked play: ranked queues exist for Vanguard and Full Battle only, one Matchmaker per format and bracket (bracket from the slots unlocked at the player's level, never the loadout); pairing by Glicko-2 rating with a widening window that both players' windows must allow (PLAYTEST in CAPS.RANKED); one rated game is one Glicko-2 rating period and RD grows by one period per idle week; one ranked battle at a time per player (in_battle); rating writes are optimistic (a stale update breaks CHECK games >= 0, aborts the list and the settlement retries up to 4 times, no SELECT FOR UPDATE); abandonment is a loss. R-SEC-008: after 3 rated games between the same pair in a rolling 24 hours (any format), further games are recorded unrated and flagged (audit ranked.repeat_pairing and a telemetry counter).

## Why it is the best case

9.1 lists Vanguard and Full as the ranked formats; the cap is strict against rating farming; the optimistic write is race-safe on PostgreSQL, SQLite and D1 (DD-15).
