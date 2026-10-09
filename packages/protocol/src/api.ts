/**
 * REST request bodies (ARCHITECTURE 6). The Worker validates every body with these schemas before
 * touching the database; game rules (loadout validity, levels) are checked by the rules engine.
 */
import { z } from 'zod';
import { Format } from './battle.ts';

export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** A calendar date YYYY-MM-DD (date of birth at sign-up; only `adult_from` is stored, R-SEC-011). */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const AuthStart = z.object({
  email: Email,
  dob: IsoDate.optional(),
  name: z.string().trim().min(2).max(24).optional(),
});
export const AuthVerify = z.object({ token: z.string().min(16).max(128) });

const ElementId = z.string().min(1).max(16);
const ModuleId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

/** A loadout as the client sends it; `validateLoadout` (R-LOAD-004) decides whether it is legal. */
export const LoadoutBody = z.object({
  elements: z.array(ElementId).min(1).max(2),
  items: z.array(ModuleId).max(6),
  itemParams: z.record(ModuleId, z.object({ element: ElementId.optional() })).optional(),
  sets: z.array(z.array(ModuleId).max(5)).min(1).max(6),
});
export type LoadoutBody = z.infer<typeof LoadoutBody>;

export const SaveLoadout = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(32),
  loadout: LoadoutBody,
});

export const NpcTier = z.enum(['wild', 'trainer', 'elite']);

/** Start a battle: a challenge link for a friend, or an NPC battle. */
export const CreateBattle = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('challenge'), format: Format, loadoutId: z.string().max(64) }),
  z.object({
    kind: z.literal('npc'),
    format: Format,
    loadoutId: z.string().max(64),
    tier: NpcTier,
  }),
]);

/** Body of `POST /api/challenges/:code/accept` (the code is in the path). */
export const AcceptChallenge = z.object({ loadoutId: z.string().max(64) });

/**
 * Alpha guest play (9.6, R-FMT-007, DD-107): a battle by one-time code at a level the creator picks,
 * with every card and item at or below that level allowed (`validateLoadout` still applies its other
 * rules), no account needed. The Worker variable `ALPHA_GUEST_PLAY=on` enables the routes.
 */
export const AlphaLevel = z.number().int().min(1).max(30);
/** `POST /api/alpha/battles`: open a lobby; the answer is `AlphaCreated`. */
export const AlphaCreate = z.object({ format: Format, level: AlphaLevel, loadout: LoadoutBody });
/** `POST /api/alpha/:code/accept`: join with a loadout legal at the lobby's level. */
export const AlphaAccept = z.object({ loadout: LoadoutBody });
/** Who the alpha routes see: a guest (signed cookie, "Guest NNNN") or a signed-in player. */
export interface AlphaIdentity {
  id: string;
  name: string;
  guest: boolean;
}
/** `GET /api/alpha/me`. */
export interface AlphaMe {
  enabled: boolean;
  me: AlphaIdentity | null;
}
/** `GET /api/alpha/:code`: what a joiner sees before accepting. */
export interface AlphaInfo {
  format: z.infer<typeof Format>;
  level: number;
  from: { name: string };
  open: boolean;
}
/** `POST /api/alpha/battles` answer: the code to share, the join link and the creator's ticket. */
export interface AlphaCreated {
  code: string;
  url: string;
  ticket: BattleTicket;
}

export const JoinQueue = z.object({ format: Format, loadoutId: z.string().max(64) });

/** Returned when a battle socket may be opened: a 60-second token bound to player and room (R-SEC-006). */
export const BattleTicket = z.object({ battleId: z.string(), token: z.string(), url: z.string() });
export type BattleTicket = z.infer<typeof BattleTicket>;

/** `POST /api/friends`: ask a player (by display name or id) to be friends (10.4). */
export const FriendRequest = z.object({ to: z.string().trim().min(1).max(64) });

/** `POST /api/world/ticket` answer: the zone socket for the player's current zone (R-SEC-006). */
export const WorldTicket = z.object({ zone: z.string(), url: z.string() });
export type WorldTicket = z.infer<typeof WorldTicket>;
