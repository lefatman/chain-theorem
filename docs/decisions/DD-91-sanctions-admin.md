# DD-91: Sanctions and the admin console: suspension (players

Status: binding under D-37 (designer may overrule).
Spec: 6.4, R-SEC-006, R-SEC-010

## Decision

Sanctions and the admin console: suspension (players.suspended_at, suspended_until, null = indefinite) revokes sessions in the same write and is checked at sign-in, session lookup, play gating and every socket upgrade; live zone, trade, queue and battle sockets are closed with code 4003 and a battle in progress follows the normal disconnect grace. A suspended player's refused sign-in carries a 15-minute token that allows only GET /api/me/export and DELETE /api/me, so data rights survive a suspension. A chat ban (players.chat_ban_until) is enforced in the zone core and told once per channel stay. Admin pages (/admin, ADMIN_EMAILS only) are server-rendered with a strict CSP and referrer policy same-origin (form posts must carry the origin); emails are masked; admins cannot sanction themselves; each action writes admin.* on the admin and moderation.* on the player without the admin id; reads are not audited. Wager, queue, ranked, challenge-link and online-screen NPC battles mark the player battling in their zone from the BattleRoom. Trade invitations: one open per inviter and 3 a minute (429 too_many_invites); guild invitations expire after 7 days.

## Why it is the best case

Minimal, auditable moderation that works without a separate admin app; R-SEC-010 export and deletion stay available to every account; no consent challenges during an external battle.
