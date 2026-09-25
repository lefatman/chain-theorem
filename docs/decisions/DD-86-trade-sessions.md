# DD-86: Trades and wagers share a TradeSession Durable Object (one per session)

Status: binding under D-37 (designer may overrule).
Spec: 10.4, R-SEC-004

## Decision

Trades and wagers share a TradeSession Durable Object (one per session). Offers carry a revision: any change to either offer or the wager format bumps it and clears every ready mark and confirmation; marks and confirms name the revision; withdrawing a ready mark clears both confirmations. A trade needs something on at least one side (gifts between subscribers allowed), a wager a stake from each player; at most 16 lines per kind and 99 per line. The invitee must be in the world (not_online otherwise); an invitation lapses after 2 minutes and an idle session after 10. Every inventory move in a trade or escrow is applied in one fixed order and deadlocks or serialization failures are retried up to 4 times; failed attempts are audited (trade_failed, wager_failed).

## Why it is the best case

R-SEC-004 on every engine (no duplication or loss under parallel trades), the 10.4 rule that any change resets both confirmations, and a record for fraud review.
