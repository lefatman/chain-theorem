# DD-100: Redo semantics: on a capture by an equal-or-higher-rank piece the position returns to before the owner's previous action (two plies: that action and the reply), pieces removed in them return, and the owner acts again

Status: binding under D-37 (designer may overrule).
Spec: 5.8, INV-04, INV-06, R-FMT-002

## Decision

Redo semantics: on a capture by an equal-or-higher-rank piece the position returns to before the owner's previous action (two plies: that action and the reply), pieces removed in them return, and the owner acts again. Charges spent (including Redo's own), reveals and the clocks are not undone; rewound positions do not count toward repetition; Redo resolves before format objectives adjudicate, so a rewound First Blood capture never happened.

## Why it is the best case

Designer answer 6 (spent charges stay spent) plus the delegated details that keep the rewind finite and fair: refunding charges would loop, un-revealing is impossible, and clocks measure real time.

## Amendment (Phase 5 build, 2026-10-06)

Built details: only a capturing move triggers Redo, because 5.4 is firm that effect captures never
chain; the rewind always goes two plies back (the previous action and the capturing reply), or one
ply when the capture was the battle's first action, and whoever is to move in the restored position
acts, which is the owner in every case but a capture inside the owner's own action; the undone plies
leave the repetition history while the restored position keeps the count it had; a REWIND ends the
action, so nothing queued after it resolves and no format objective is adjudicated; Redo carries
the `replay` tag (time manipulation), so Warden's Stopwatch negates it; the pre-action snapshots
that make it possible are kept only while a side carries a rewind ability and never leave the
engine (R-SEC-001).
