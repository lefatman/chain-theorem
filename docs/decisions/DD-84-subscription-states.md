# DD-84: Subscription states: trialing counts as active; past_due keeps access until the paid period ends while the provider retries; canceled keeps access until the cancel date; paused has no access; a completed transaction extends access to the end of its billing period

Status: binding under D-37 (designer may overrule).
Spec: 14.4, R-COST-005, R-SEC-010

## Decision

Subscription states: trialing counts as active; past_due keeps access until the paid period ends while the provider retries; canceled keeps access until the cancel date; paused has no access; a completed transaction extends access to the end of its billing period. One live subscription at a time (409 while active or past_due); the in-app cancel takes effect at period end and can be resumed; account deletion cancels immediately first and keeps the account (502) if the provider cannot be reached. Billing ids live in billing_accounts, not players. Accounts from before M6 get trial_ends_at = created_at + 7 days (no fresh trial).

## Why it is the best case

Matches the COMMITTED entitlement rules (14.4); a deleted account is never billed (R-SEC-010); the players table keeps minimal personal data.
