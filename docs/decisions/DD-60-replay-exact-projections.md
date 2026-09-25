# DD-60: Reconnect replay sends each side the exact projected events it was sent live (stored per log record), not a re-projection of old events against today's reveal log

Status: binding under D-37 (designer may overrule).
Spec: 13.4, R-NET-001, R-INFO-005

## Decision

Reconnect replay sends each side the exact projected events it was sent live (stored per log record), not a re-projection of old events against today's reveal log.

## Why it is the best case

A re-projection would show ability names learned later and differ from what the player saw; storing per-side projections costs about 3x the raw log (a 160-ply battle stays under 250 KB).
