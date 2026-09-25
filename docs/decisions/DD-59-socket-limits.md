# DD-59: Socket rate limits are token buckets per battle side (5 msgs/s, burst 10) that survive reconnects; invalid or refused messages count as strikes; 50 strikes in a row close the socket with 1008; an err is sent only on the first strike of a streak

Status: binding under D-37 (designer may overrule).
Spec: R-SEC-005, R-NET-001

## Decision

Socket rate limits are token buckets per battle side (5 msgs/s, burst 10) that survive reconnects; invalid or refused messages count as strikes; 50 strikes in a row close the socket with 1008; an err is sent only on the first strike of a streak. Streamed messages (bev, prompt, bend, opp, drawOffer) go only to a side that sent hello on its current socket; one socket per side, a new one replaces the old.

## Why it is the best case

R-SEC-005 limits must not reset by reconnecting; hello-gated streaming makes reconnect replay exact.
