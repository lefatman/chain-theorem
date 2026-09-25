# DD-79: Parties across zones: party invites are stateless ids <expiry>

Status: binding under D-37 (designer may overrule).
Spec: 10.4, R-WORLD-004, R-SEC-011

## Decision

Parties across zones: party invites are stateless ids <expiry>.<inviter>.<HMAC over expiry, inviter and invitee> valid 5 minutes for the invitee only; accepting creates the inviter's party when needed; every membership change sends the new view (with the youngest-member flag) to each member's channel; party travel means members in the leader's channel follow the leader through warps, and the Worker offers a party member's channel first when a player enters a zone. Host-side failures answer err codes party_full, in_party, not_online, invite_expired and battle_failed.

## Why it is the best case

No shared invite storage across zone channels, a forwarded invite is useless to anyone else, and parties stay together across warps (10.4) with R-SEC-011 filtering always current.
