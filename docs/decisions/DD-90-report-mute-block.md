# DD-90: Report, mute and block: any player (minors and trial accounts included) can report (fixed reasons, a note up to 500 characters, optional chat, battle or trade context; 10 reports a day), mute and block (200 each); the reported player never learns who reported

Status: binding under D-37 (designer may overrule).
Spec: 15, R-SEC-011, R-WORLD-004

## Decision

Report, mute and block: any player (minors and trial accounts included) can report (fixed reasons, a note up to 500 characters, optional chat, battle or trade context; 10 reports a day), mute and block (200 each); the reported player never learns who reported. Mute is silent and one-way (the muted player's lines are dropped for the muter on every channel, a muted whisper is dropped without a bounce). Block adds refusals in both directions that reuse codes other causes also produce (whisper_refused, busy, not_online, invite_expired; a blocked guild invite or friend request is stored but never shown), so a block is never revealed; on public channels a block works like a mute. PlayerInit carries only the player's own lists; the other direction is enforced by the recipient's core and by database checks in REST routes.

## Why it is the best case

R-SEC-011 says report, mute and block stay available to everyone; no information leak about who blocked or reported whom; bounded headers and no list of blockers ever sent.
