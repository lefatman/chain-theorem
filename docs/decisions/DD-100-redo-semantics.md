# DD-100: Redo semantics: on a capture by an equal-or-higher-rank piece the position returns to before the owner's previous action (two plies: that action and the reply), pieces removed in them return, and the owner acts again

Status: binding under D-37 (designer may overrule).
Spec: 5.8, INV-04, INV-06, R-FMT-002

## Decision

Redo semantics: on a capture by an equal-or-higher-rank piece the position returns to before the owner's previous action (two plies: that action and the reply), pieces removed in them return, and the owner acts again. Charges spent (including Redo's own), reveals and the clocks are not undone; rewound positions do not count toward repetition; Redo resolves before format objectives adjudicate, so a rewound First Blood capture never happened.

## Why it is the best case

Designer answer 6 (spent charges stay spent) plus the delegated details that keep the rewind finite and fair: refunding charges would loop, un-revealing is impossible, and clocks measure real time.
