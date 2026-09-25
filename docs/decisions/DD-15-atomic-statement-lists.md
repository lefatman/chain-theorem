# DD-15: Every multi-row write (rewards, trades, wagers) is an ordered list of statements executed atomically: BEGIN/COMMIT on PostgreSQL and better-sqlite3, batch() on D1

Status: binding under D-37 (designer may overrule).
Spec: 13.6, R-SEC-004

## Decision

Every multi-row write (rewards, trades, wagers) is an ordered list of statements executed atomically: BEGIN/COMMIT on PostgreSQL and better-sqlite3, batch() on D1. Invariants live inside the write: CHECK (qty >= 0) aborts over-spends, conditional updates are verified by row counts where the driver reports them, and unique keys make grants idempotent.

## Why it is the best case

D1 has no interactive transactions, yet local wrangler dev must use D1 (BUILD_PROMPT M4); constraint-enforced atomic batches are race-safe on all three engines without SELECT … FOR UPDATE.
