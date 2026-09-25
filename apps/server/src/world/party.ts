/**
 * Parties across zones (M5 5.4, 10.4): the host side of the zone core's `party` effects. A party lives
 * in the database (at most 4 members, race-safe joins); every member's zone channel gets the new view
 * on any change, with `minor` recomputed so party chat is filtered by its youngest member (R-SEC-011).
 *
 * Invitations are stateless (DD-79): the invite id is `<expiry>.<inviter>.<mac>`, an HMAC over the
 * expiry, the inviter and the invitee, so any zone can check a reply without shared storage, and a
 * forwarded invite id is useless to anyone but the invitee.
 */
import type { Db } from '@chain-theorem/db';
import { PARTY_MAX } from '@chain-theorem/db';
import { hmac } from '../auth/crypto.ts';
import type { PartyOp, ZoneErrCode } from '../zone/index.ts';
import { partyView } from './progress.ts';
import type { ZoneCall } from './routing.ts';

export const INVITE_TTL_MS = 5 * 60_000;
const MAC_CHARS = 22;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** An invite id (at most 64 characters, the protocol's id limit). Player ids are UUIDs. */
export async function signInvite(
  secret: string,
  from: string,
  to: string,
  now: number,
): Promise<string> {
  if (!UUID.test(from)) throw new Error('invite: bad inviter id');
  const exp = Math.floor((now + INVITE_TTL_MS) / 1000).toString(36);
  const who = from.replaceAll('-', '');
  const mac = (await hmac(secret, `invite.${exp}.${from}.${to}`)).slice(0, MAC_CHARS);
  return `${exp}.${who}.${mac}`;
}

/** The inviter when `token` is an unexpired invite for `to`; otherwise null. */
export async function verifyInvite(
  secret: string,
  token: string,
  to: string,
  now: number,
): Promise<string | null> {
  const [exp, who, mac, extra] = token.split('.');
  if (!exp || !who || !mac || extra !== undefined || !/^[0-9a-f]{32}$/.test(who)) return null;
  const from = `${who.slice(0, 8)}-${who.slice(8, 12)}-${who.slice(12, 16)}-${who.slice(16, 20)}-${who.slice(20)}`;
  const want = (await hmac(secret, `invite.${exp}.${from}.${to}`)).slice(0, MAC_CHARS);
  if (!sameString(mac, want)) return null;
  const expMs = parseInt(exp, 36) * 1000;
  if (!Number.isFinite(expMs) || now > expMs) return null;
  return from;
}

/** What the party logic needs from its host (a ZoneRoom). */
export interface PartyHost {
  db: Db;
  secret: string;
  now: number;
  /** A host call to the player's zone channel (this one or another); false when not reachable. */
  call(playerId: string, call: ZoneCall, body: unknown): Promise<boolean>;
  /** Tell a player in this channel why their request failed. */
  notice(playerId: string, code: ZoneErrCode): Promise<void>;
}

/** Send the current party view to every member (and `null` to anyone who just left). */
export async function broadcastParty(
  h: PartyHost,
  partyId: string | null,
  left: string[] = [],
): Promise<void> {
  const party = partyId ? await h.db.social.party(partyId) : null;
  const view = await partyView(h.db, party, h.now);
  for (const m of party?.members ?? [])
    await h.call(m.playerId, 'party', { id: m.playerId, party: view });
  for (const id of left) await h.call(id, 'party', { id, party: null });
}

export async function partyOp(h: PartyHost, op: PartyOp): Promise<void> {
  const { db } = h;
  switch (op.op) {
    case 'invite': {
      const target = await db.players.getById(op.to);
      if (!target || !(await db.world.presence(op.to))) return h.notice(op.from, 'not_online');
      if (await db.social.partyOf(op.to)) return h.notice(op.from, 'in_party');
      const mine = await db.social.partyOf(op.from);
      if (mine && mine.members.length >= PARTY_MAX) return h.notice(op.from, 'party_full');
      const id = await signInvite(h.secret, op.from, op.to, h.now);
      const sent = await h.call(op.to, 'invite', {
        to: op.to,
        invite: { id, from: op.from, name: op.name },
      });
      if (!sent) await h.notice(op.from, 'not_online');
      return;
    }
    case 'reply': {
      const from = await verifyInvite(h.secret, op.invite, op.from, h.now);
      if (!from) return h.notice(op.from, 'invite_expired');
      if (!op.accept) return;
      if (await db.social.partyOf(op.from)) return h.notice(op.from, 'in_party');
      if (!(await db.players.getById(from))) return h.notice(op.from, 'invite_expired');
      const party = (await db.social.partyOf(from)) ?? (await db.social.createParty(from, h.now));
      if (!(await db.social.joinParty(party.id, op.from, h.now)))
        return h.notice(op.from, 'party_full');
      await broadcastParty(h, party.id);
      return;
    }
    case 'leave': {
      const before = await db.social.partyOf(op.from);
      if (!before) return h.notice(op.from, 'no_party');
      await db.social.leaveParty(op.from);
      const rest = before.members.some((m) => m.playerId !== op.from) ? before.id : null;
      await broadcastParty(h, rest, [op.from]);
      return;
    }
  }
}
