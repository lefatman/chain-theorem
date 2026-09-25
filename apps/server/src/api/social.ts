/** Friends (M5, 10.4): requests by display name or id, mutual requests make friends, presence for friends. */
import { FriendRequest } from '@chain-theorem/protocol';
import { HttpError, body, json, noContent, type Router } from '../http.ts';
import type { Ctx } from './context.ts';

export function socialRoutes(r: Router<Ctx>): void {
  r.add('GET', '/api/friends', async (_req, ctx) => {
    const me = await ctx.requireMe();
    return json({ friends: await ctx.db.social.friends(me.id) });
  });

  r.add('POST', '/api/friends', async (req, ctx) => {
    const me = await ctx.requireMe();
    const { to } = await body(req, FriendRequest);
    // By id, or by display name when exactly one player has it (names are not unique).
    const byName = await ctx.db.players.findByDisplayName(to, 2);
    const target = (await ctx.db.players.getById(to)) ?? (byName.length === 1 ? byName[0] : null);
    if (!target || target.id === me.id)
      throw new HttpError(404, byName.length > 1 ? 'ambiguous_name' : 'not_found');
    return json({ status: await ctx.db.social.requestFriend(me.id, target.id, ctx.now) });
  });

  r.add('DELETE', '/api/friends/:id', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    await ctx.db.social.removeFriend(me.id, params.id ?? '');
    return noContent();
  });
}
