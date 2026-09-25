# DD-92: Spectating: a spectator learns about each army exactly what that army's opponent knows (its reveal log, known to both players), so Scout and Scout's Lens reveals are public; spectators get the board, levels, consumed slots, reveal logs, displayed elements as the opponent sees them, use counters for nameable abilities and who is choosing, never loadouts, sets, legal moves, prompt contents, ChoiceMade, pending burns, private slices, or fizzles and charges of abilities the opponent cannot name; slices reach spectators only through an optional stateSlice

Status: binding under D-37 (designer may overrule).
Spec: 8, 10.4, R-INFO-005, R-SEC-001, R-SEC-011

## Decision

Spectating: a spectator learns about each army exactly what that army's opponent knows (its reveal log, known to both players), so Scout and Scout's Lens reveals are public; spectators get the board, levels, consumed slots, reveal logs, displayed elements as the opponent sees them, use counters for nameable abilities and who is choosing, never loadouts, sets, legal moves, prompt contents, ChoiceMade, pending burns, private slices, or fizzles and charges of abilities the opponent cannot name; slices reach spectators only through an optional stateSlice.spectate hook (hidden when absent). Spectators run 2 plies behind (start shown at once, everything at the end, clocks frozen at the delayed position), with per-record spectator events stored and delayed views kept in the saved battle state. Listed battles are ranked, tournament and challenge-zone battles; a player may opt out (players.spectate, NULL = on for adults and off under 18); a block in either direction hides the battle from that viewer; any signed-in account may watch; 50 spectators per room; the watcher count is sent to players and spectators.

## Why it is the best case

R-INFO-005 and R-SEC-001 hold for spectators with no timers; nothing either player alone saw leaks; minors are private by default (R-SEC-011 spirit); private arrangements stay private.
