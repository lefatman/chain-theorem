# DD-80: Zone hosting: each zone has up to 32 channels of 60 (ZoneRoom zone:<zone>:<channel>); presence (zone, channel) is set on admission and cleared on leave only while it still names that channel; player tiles are mirrored into WebSocket attachments so steps write no storage yet survive hibernation; the core snapshot is stored only when the core asks; the first visit to a zone pays 25 discovery XP once (after the client has its snapshot); a battle that ends after its player left the zone applies quest and lesson progress from storage

Status: binding under D-37 (designer may overrule).
Spec: 10.1, 7.5, R-WORLD-001, R-COST-002

## Decision

Zone hosting: each zone has up to 32 channels of 60 (ZoneRoom zone:<zone>:<channel>); presence (zone, channel) is set on admission and cleared on leave only while it still names that channel; player tiles are mirrored into WebSocket attachments so steps write no storage yet survive hibernation; the core snapshot is stored only when the core asks; the first visit to a zone pays 25 discovery XP once (after the client has its snapshot); a battle that ends after its player left the zone applies quest and lesson progress from storage.

## Why it is the best case

R-COST-002 (no per-step writes, hibernation-eligible rooms), R-WORLD-001 channel overflow, 7.5 discoveries, and no progress is lost when a player closes the world mid-battle.
