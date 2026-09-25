# DD-37: The projection includes the viewer's legal moves computed by the server from the true state, so a client never offers an illegal move or rejects a legal one (for example a revealed Stalwart king that may be captured)

Status: binding under D-37 (designer may overrule).
Spec: 8.4, R-SEC-002

## Decision

The projection includes the viewer's legal moves computed by the server from the true state, so a client never offers an illegal move or rejects a legal one (for example a revealed Stalwart king that may be captured).

## Why it is the best case

The server is the authority (R-SEC-002); a client-side list could diverge under Masquerade Mask.
