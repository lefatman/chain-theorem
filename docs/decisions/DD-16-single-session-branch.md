# DD-16: The build environment pins one development branch (claude/admiring-keller-uk28l5) with a remote, so every step is committed there as small conventional commits citing requirement IDs and pushed; pull requests are opened from it on request instead of one branch per step

Status: binding under D-37 (designer may overrule).
Spec: BUILD_PROMPT 5

## Decision

The build environment pins one development branch (claude/admiring-keller-uk28l5) with a remote, so every step is committed there as small conventional commits citing requirement IDs and pushed; pull requests are opened from it on request instead of one branch per step.

## Why it is the best case

The session may only push to its designated branch; per-step commits keep the history reviewable step by step.
