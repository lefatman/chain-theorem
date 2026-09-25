# DD-70: Chat safety details: a zone channel is filtered when any member (including one not yet past hello) is under 18; minors are always filtered whatever their preference; recipients apply their own view on delivery; whispers involving a minor need friendship both ways, and a refused whisper answers exactly like an offline target; zone chat echoes to the sender, whispers do not; guild chat answers no_guild until M6

Status: binding under D-37 (designer may overrule).
Spec: 10.6, R-SEC-011

## Decision

Chat safety details: a zone channel is filtered when any member (including one not yet past hello) is under 18; minors are always filtered whatever their preference; recipients apply their own view on delivery; whispers involving a minor need friendship both ways, and a refused whisper answers exactly like an offline target; zone chat echoes to the sender, whispers do not; guild chat answers no_guild until M6. The filter is an original word list plus off-platform contact words, catches spaced and look-alike spellings, strips invisible characters and masks links, emails and phone numbers.

## Why it is the best case

R-SEC-011 applied to the youngest participant at delivery time, and a refusal never reveals another player's age.
