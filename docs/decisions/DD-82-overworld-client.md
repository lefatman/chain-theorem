# DD-82: Overworld client: one tile per 150 ms and at least 125 ms between step messages (turns included), so never more than 8 a second; a wall bump is predicted as a turn and its matching zpos ignored, any other zpos snaps back and resyncs with hello; the zone socket stays open during a world battle and closes when the player leaves the world screen for anything else; close codes 4000 (replaced by another tab) and 1008 (policy) stop reconnecting and offer a Reconnect button, other closes reconnect with backoff 0

Status: binding under D-37 (designer may overrule).
Spec: 10.1, R-SEC-005, R-WORLD-001

## Decision

Overworld client: one tile per 150 ms and at least 125 ms between step messages (turns included), so never more than 8 a second; a wall bump is predicted as a turn and its matching zpos ignored, any other zpos snaps back and resyncs with hello; the zone socket stays open during a world battle and closes when the player leaves the world screen for anything else; close codes 4000 (replaced by another tab) and 1008 (policy) stop reconnecting and offer a Reconnect button, other closes reconnect with backoff 0.5 to 8 s and a fresh ticket; the chat filter choice is kept per device and sent after each hello only when set; zone tiles come from the content tileset with procedural painters as the fallback.

## Why it is the best case

Stays inside R-SEC-005 with margin, keeps prediction cheap (no full resync for a bump), never fights another tab for the same player, and keeps the battling marker honest while the player fights (10.1).
