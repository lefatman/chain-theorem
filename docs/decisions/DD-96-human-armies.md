# DD-96: Battle pieces are human soldiers in four army styles (Roman, medieval, Arab, samurai) instead of creatures: 24 units at 32 px in handheld-era proportions

Status: binding under D-37 (designer may overrule).
Spec: 11.1, 11.2, R-ART-001, R-ART-002, R-ART-003

## Decision

Battle pieces are human soldiers in four army styles (Roman, medieval, Arab, samurai) instead of creatures: 24 units at 32 px in handheld-era proportions. The owner shows in the armour colour (white steel for White, black iron for Black) on top of the front/back pose and the base ring; the element in the accent colour and the element's emblem on the shield, chest or cape. A player's own army style is a local cosmetic setting; the opponent's style derives from their name and always differs from the player's. Drop-in art moves to assets/army/<style>/<side>[/<element>]/<type>.png.

## Why it is the best case

Designer direction after the M7 build. Human armies keep every 11.2 readability cue (silhouette by type across styles, owner by pose, ring and now armour, element by icon, tint and emblem, each checked by tests under colour-vision simulations), need no protocol change (styles are cosmetic and local) and stay inside R-ART-003 (original designs, plain historical unit names checked against the deny list).
