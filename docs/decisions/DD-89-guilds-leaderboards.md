# DD-89: Guilds and leaderboards: every guild invariant is a database constraint (case-insensitive unique name, unique tag, one guild per player, one leader per guild, CHECK size <= max_size with max_size copied from CAPS at creation); every guild change first bumps roster_version, which serializes changes and invalidates the GuildRoom roster cache so guild chat filtering (any member under 18 filters the channel for everyone) changes before the next line; a leaving or deleted leader hands over to the longest-serving officer, else member, and an empty guild is deleted; guild names and tags must pass the chat filter and may not contain a 7-digit run; leaderboards per format and bracket list players with RD at most 200 and at least 5 games (top 50, tied ratings share a rank); the guild leaderboard scores the mean of a guild's best 5 listed members and needs at least 2; leaderboards need sign-in; guild invitations do not expire yet

Status: binding under D-37 (designer may overrule).
Spec: 10.4, R-WORLD-004, R-SEC-011

## Decision

Guilds and leaderboards: every guild invariant is a database constraint (case-insensitive unique name, unique tag, one guild per player, one leader per guild, CHECK size <= max_size with max_size copied from CAPS at creation); every guild change first bumps roster_version, which serializes changes and invalidates the GuildRoom roster cache so guild chat filtering (any member under 18 filters the channel for everyone) changes before the next line; a leaving or deleted leader hands over to the longest-serving officer, else member, and an empty guild is deleted; guild names and tags must pass the chat filter and may not contain a 7-digit run; leaderboards per format and bracket list players with RD at most 200 and at least 5 games (top 50, tied ratings share a rank); the guild leaderboard scores the mean of a guild's best 5 listed members and needs at least 2; leaderboards need sign-in; guild invitations do not expire yet.

## Why it is the best case

Race-safe on every engine, R-SEC-011 recomputed on every membership change, and names minors see on leaderboards stay clean.
