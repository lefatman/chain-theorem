# DD-107: Alpha guest play (9

Status: binding under D-37 (designer may overrule).
Spec: 9.6, R-FMT-007, R-SEC-006, R-SEC-003, R-LOAD-004, DD-65

## Decision

Alpha guest play (9.6, R-FMT-007): a Worker flag ALPHA_GUEST_PLAY=on enables guest identities (a signed 24-hour HttpOnly cookie, id g-NNNN-<ten random characters>, shown as Guest NNNN) and one-time-code battles in a-<code> rooms at a level the creator picks, with the whole catalogue at or below that level allowed (validateLoadout without the ownership rule) and the joiner bound to the same level; colours random; the lobby closes by alarm after 30 minutes unused; the room writes no battles row, pays no XP, rewards or rating, tells no zone and is never listed; a guest is signed out on every other route and its socket ticket opens only alpha battles while the flag is on; guest creation is limited to 10 per address per 10 minutes per Worker isolate; signed-in players may use the routes too, at the chosen level.

## Why it is the best case

The designer asked for an alpha test mode in which non-logged-in players share a one-time code and play at a level they choose with the matching unlocks. A signed cookie needs no table and leaves nothing to delete (R-SEC-010); the a- prefix keeps alpha rooms out of the challenge-link routes; writing nothing keeps the progression, rating and spectating paths untouched (R-SEC-003); the flag keeps the mode off in production until the designer opens it; the per-isolate limiter is enough against a script minting guests in a loop without a new table.
