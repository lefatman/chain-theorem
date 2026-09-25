# DD-87: Wager escrow: live stakes sit in a wager_escrows table (written before the battles row exists) and the settled wager is also recorded in wagers; exactly-once settlement uses a database-checked counter (at most 1) because D1 batches cannot abort on a row count; the wager id is <session>:<attempt> so a failed attempt whose stakes went back never blocks a retry; each player fights with the newest legal saved loadout (DD-78) taken before escrow and colours are random; wager battles pay normal PvP battle XP and are never rated; a TradeSession checks every 5 minutes and settles a finished battle whose room failed to settle, and returns stakes of a battle that never started; loadout validity is recomputed for both players after a trade, an escrow and a settlement; a deleted player's share goes with the account

Status: binding under D-37 (designer may overrule).
Spec: 9.5, R-FMT-006, R-SEC-004

## Decision

Wager escrow: live stakes sit in a wager_escrows table (written before the battles row exists) and the settled wager is also recorded in wagers; exactly-once settlement uses a database-checked counter (at most 1) because D1 batches cannot abort on a row count; the wager id is <session>:<attempt> so a failed attempt whose stakes went back never blocks a retry; each player fights with the newest legal saved loadout (DD-78) taken before escrow and colours are random; wager battles pay normal PvP battle XP and are never rated; a TradeSession checks every 5 minutes and settles a finished battle whose room failed to settle, and returns stakes of a battle that never started; loadout validity is recomputed for both players after a trade, an escrow and a settlement; a deleted player's share goes with the account.

## Why it is the best case

9.5 COMMITTED rules (escrow at battle start, the winner takes both stakes in one transaction, a draw returns them, abandonment is a loss) with no stuck stakes after a failure.
