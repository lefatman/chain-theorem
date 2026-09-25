# DD-62: Database portability details: spends inside atomic lists are enforced by CHECK (qty >= 0) with a pre-inserted zero row (D1 batches cannot abort on a row count); the standalone spend uses WHERE qty >= n with the affected-row count; reward_grants is unique on (grant_key, player_id); booleans are INTEGER 0/1 on every engine; migrate() re-reads its ledger after a failure and moves on when another runner applied the migration

Status: binding under D-37 (designer may overrule).
Spec: 13.6, DD-15, R-SEC-003, R-SEC-004

## Decision

Database portability details: spends inside atomic lists are enforced by CHECK (qty >= 0) with a pre-inserted zero row (D1 batches cannot abort on a row count); the standalone spend uses WHERE qty >= n with the affected-row count; reward_grants is unique on (grant_key, player_id); booleans are INTEGER 0/1 on every engine; migrate() re-reads its ledger after a failure and moves on when another runner applied the migration.

## Why it is the best case

One behaviour on PostgreSQL, better-sqlite3 and D1 without SELECT ... FOR UPDATE (13.6, DD-15).
