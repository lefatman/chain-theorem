# DD-63: Account deletion (R-SEC-010) removes every player-owned row and the email's login tokens in one atomic list; shared records keep the other party's history with this player's side set to NULL (battles, trades, guild owner)

Status: binding under D-37 (designer may overrule).
Spec: R-SEC-010, R-SEC-011

## Decision

Account deletion (R-SEC-010) removes every player-owned row and the email's login tokens in one atomic list; shared records keep the other party's history with this player's side set to NULL (battles, trades, guild owner). Pending sign-up data (display name, adult_from, OAuth link) lives only in the single-use login token.

## Why it is the best case

Minimum personal data and a clean erase, without destroying other players' battle and trade history.
