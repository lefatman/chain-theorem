/** Account routes: profile, data export and deletion (R-SEC-010), inventory, saved loadouts (7.4). */
import { MAX_SAVED_LOADOUTS, engine } from '@chain-theorem/content';
import { SaveLoadout } from '@chain-theorem/protocol';
import type { Loadout, LoadoutError } from '@chain-theorem/rules';
import type { Loadout as SavedRow } from '@chain-theorem/db';
import { HttpError, body, json, noContent, type Router } from '../http.ts';
import { playerFacts } from './collection.ts';
import { publicMe, sessionCookie, type Ctx } from './context.ts';

export interface LoadoutView {
  id: string;
  name: string;
  loadout: Loadout;
  valid: boolean;
  errors: LoadoutError[];
}

/** Validity is always recomputed: levels and collections change after a loadout is saved. */
export async function viewLoadouts(
  ctx: Ctx,
  playerId: string,
  level: number,
  rows: SavedRow[],
): Promise<LoadoutView[]> {
  const facts = await playerFacts(ctx.db, playerId, level);
  return rows.map((row) => {
    const loadout = row.loadout as Loadout;
    const v = engine.validateLoadout(loadout, facts);
    return { id: row.id, name: row.name, loadout, valid: v.ok, errors: v.errors };
  });
}

/** A saved loadout of the signed-in player that is legal right now, or 400 invalid_loadout. */
export async function legalLoadout(
  ctx: Ctx,
  loadoutId: string,
): Promise<{ loadout: Loadout; level: number; name: string; playerId: string }> {
  const me = await ctx.requireMe();
  const rows = await ctx.db.loadouts.list(me.id);
  const row = rows.find((r) => r.id === loadoutId);
  if (!row) throw new HttpError(404, 'not_found');
  const [view] = await viewLoadouts(ctx, me.id, me.level, [row]);
  if (!view?.valid) throw new HttpError(400, 'invalid_loadout');
  return { loadout: view.loadout, level: me.level, name: me.displayName, playerId: me.id };
}

export function accountRoutes(r: Router<Ctx>): void {
  r.add('GET', '/api/me', async (_req, ctx) => {
    const me = await ctx.me();
    return json({ me: me ? publicMe(me) : null });
  });

  r.add('GET', '/api/me/export', async (_req, ctx) => {
    const me = await ctx.requireMe();
    const data = await ctx.db.players.exportData(me.id, ctx.now);
    return json(data, 200, {
      'content-disposition': 'attachment; filename="chain-theorem-export.json"',
    });
  });

  r.add('DELETE', '/api/me', async (_req, ctx) => {
    const me = await ctx.requireMe();
    await ctx.db.players.delete(me.id);
    return noContent({ 'set-cookie': sessionCookie(ctx.env, '', 0) });
  });

  r.add('GET', '/api/inventory', async (_req, ctx) => {
    const me = await ctx.requireMe();
    const inv = await ctx.db.inventory.list(me.id);
    return json({
      items: inv.items.map((x) => ({ id: x.itemId, qty: x.qty })),
      cards: inv.cards.map((x) => ({ id: x.abilityId, qty: x.qty })),
    });
  });

  r.add('GET', '/api/loadouts', async (_req, ctx) => {
    const me = await ctx.requireMe();
    return json({
      loadouts: await viewLoadouts(ctx, me.id, me.level, await ctx.db.loadouts.list(me.id)),
    });
  });

  r.add('PUT', '/api/loadouts', async (req, ctx) => {
    const me = await ctx.requireMe();
    const input = await body(req, SaveLoadout);
    if (!input.id && (await ctx.db.loadouts.count(me.id)) >= MAX_SAVED_LOADOUTS)
      throw new HttpError(400, 'too_many_loadouts');
    const facts = await playerFacts(ctx.db, me.id, me.level);
    const v = engine.validateLoadout(input.loadout as Loadout, facts);
    const saved = await ctx.db.loadouts.save(me.id, {
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      loadout: input.loadout,
      isValid: v.ok,
      now: ctx.now,
    });
    if (!saved) throw new HttpError(404, 'not_found');
    return json({
      id: saved.id,
      name: saved.name,
      loadout: saved.loadout,
      valid: v.ok,
      errors: v.errors,
    });
  });

  r.add('DELETE', '/api/loadouts/:id', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    if (!(await ctx.db.loadouts.delete(me.id, params.id ?? '')))
      throw new HttpError(404, 'not_found');
    return noContent();
  });
}
