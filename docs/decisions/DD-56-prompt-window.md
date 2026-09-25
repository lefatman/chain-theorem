# DD-56: A mid-action prompt waits at most 15 seconds (spec 5

Status: binding under D-37 (designer may overrule).
Spec: 5.4, 9.2, DD-18, R-FMT-003

## Decision

A mid-action prompt waits at most 15 seconds (spec 5.4) and never past the chooser's flag time; when the window ends the request's defaultOption applies (DD-18) and the chooser's clock is charged for the wait; if the flag falls first the chooser loses on time.

## Why it is the best case

Keeps prompts from stalling a battle while charging their time to the chooser as 9.2 requires.
