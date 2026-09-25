# DD-52: Accepted residual hint under Masquerade Mask: the viewer's own legal-move list (DD-37) is exact, so a square attacked only through an opponent's Flow line is missing from the viewer's king moves before the Mask drops

Status: binding under D-37 (designer may overrule).
Spec: DD-37, DD-26, R-ELEM-006

## Decision

Accepted residual hint under Masquerade Mask: the viewer's own legal-move list (DD-37) is exact, so a square attacked only through an opponent's Flow line is missing from the viewer's king moves before the Mask drops. The Mask is not dropped by this; it drops when a Tide piece visibly moves or checks through its own pieces (DD-44).

## Why it is the best case

Legality must stay exact (R-SEC-002, DD-37); hiding the restriction would let a player make an illegal move. The hint is indirect (the opponent must also infer which piece attacks) and the Mask is a PLAYTEST item.
