/**
 * Overworld routes (M5, ARCHITECTURE 6): the zone ticket, the zone socket upgrade with channel choice
 * (10.1), the HUD's progress, and the cost dashboard (14.2, admins only).
 */
import { CAPS } from '@chain-theorem/content';
import { world, xpForLevel, xpToNext, zoneById } from '@chain-theorem/content/world';
import type { Db } from '@chain-theorem/db';
import type { WorldTicket } from '@chain-theorem/protocol';
import { signTicket, verifyTicket } from '../auth/tickets.ts';
import { refusePlay, requirePlay } from '../billing/gate.ts';
import type { Env } from '../env.ts';
import { HttpError, json, type Router } from '../http.ts';
import type { CostDashboard } from '../metrics.ts';
import type { RoomInfo } from '../rooms/battle-room.ts';
import { metricsStub } from '../rooms/metrics.ts';
import { ZONE_HEADERS } from '../rooms/zone-room.ts';
import { factsFromFlags, loadPlayerInit, storedQuests } from '../world/progress.ts';
import { MAX_CHANNELS, zoneStub } from '../world/routing.ts';
import type { Ctx } from './context.ts';

/** The zone a player (re)enters: the saved one when it still exists, else the start zone. */
export function entryZone(saved: string | null): string {
  return saved && zoneById.has(saved) ? saved : world.start.zone;
}

/** Still in a battle that has not ended (a reload mid-battle keeps the battling marker, 10.1). */
async function inBattle(env: Env, db: Db, playerId: string): Promise<boolean> {
  for (const b of (await db.battles.listActiveForPlayer(playerId, 3)).slice(0, 3)) {
    const res = await env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(b.id)).fetch(
      'https://room/info',
    );
    if (((await res.json()) as RoomInfo).status === 'active') return true;
  }
  return false;
}

/**
 * `/ws/zone/:zone?t=`: check the ticket, load the player, then offer the upgrade to the channels in
 * order: where party members are first (party travel lands together), then 0, 1, 2 ... A full
 * channel answers 409 and the next one is tried (10.1: overflow opens a parallel channel).
 */
export async function zoneSocket(
  req: Request,
  env: Env,
  db: Db,
  zone: string,
  token: string,
  now: number,
): Promise<Response> {
  if (!zoneById.has(zone)) return json({ error: 'not_found' }, 404);
  const player = await verifyTicket(env.AUTH_SECRET, token, `zone:${zone}`, now);
  if (!player) return json({ error: 'bad_ticket' }, 403);
  // Entitlement is re-read at connect (14.4, R-SEC-007): a 60 s ticket may outlive the trial.
  const who = await db.players.getById(player);
  if (!who) return json({ error: 'not_found' }, 404);
  const refused = refusePlay(who, now);
  if (refused) return refused;
  const loaded = await loadPlayerInit(db, player, zone, now, await inBattle(env, db, player));
  if (!loaded) return json({ error: 'not_found' }, 404);
  const preferred: number[] = [];
  for (const m of loaded.init.party?.members ?? []) {
    if (m.p === player) continue;
    const at = await db.world.presence(m.p);
    if (at?.zone === zone && !preferred.includes(at.channel)) preferred.push(at.channel);
  }
  const order = [...preferred, ...Array.from({ length: MAX_CHANNELS }, (_, i) => i)].filter(
    (c, i, all) => all.indexOf(c) === i,
  );
  for (const channel of order) {
    const headers = new Headers(req.headers);
    // Only the Worker sets these (a client's own copies are dropped).
    for (const h of Object.values(ZONE_HEADERS)) headers.delete(h);
    headers.set(ZONE_HEADERS.init, JSON.stringify(loaded.init));
    headers.set(ZONE_HEADERS.key, JSON.stringify({ zone, channel }));
    if (loaded.firstVisit) headers.set(ZONE_HEADERS.discover, '1');
    const res = await zoneStub(env, zone, channel).fetch(
      new Request('https://zone/ws', { headers }),
    );
    if (res.status !== 409) return res;
  }
  return json({ error: 'zone_full' }, 503);
}

function admins(env: Env): string[] {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function requireAdmin(ctx: Ctx): Promise<void> {
  const me = await ctx.requireMe();
  if (!admins(ctx.env).includes(me.email.toLowerCase())) throw new HttpError(403, 'forbidden');
}

async function dashboard(env: Env, hours: number, now: number): Promise<CostDashboard> {
  const res = await metricsStub(env).fetch(`https://metrics/dashboard?hours=${hours}&now=${now}`);
  return (await res.json()) as CostDashboard;
}

const usd = (n: number, digits = 4) => `$${n.toFixed(digits)}`;
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** The cost dashboard page (server-rendered, no script). */
export function dashboardHtml(d: CostDashboard): string {
  const rows = d.hours
    .map((h) => {
      const r = h.rollup;
      return `<tr${h.alert ? ' class="alert"' : ''}><td>${esc(new Date(h.hour).toISOString().slice(0, 13))}:00</td><td>${(r.playerMs / 3_600_000).toFixed(2)}</td><td>${r.zoneIn}</td><td>${r.battles}</td><td>${r.battleIn}</td><td>${r.rowsWritten}</td><td>${usd(h.cost.total, 6)}</td><td>${usd(h.cost.perPlayerHour, 6)}</td><td>${usd(h.cost.perSubscriberMonth)}</td></tr>`;
    })
    .join('');
  const t = d.total;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cost dashboard</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1b1b;--line:#ccc;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--line:#444;--bad:#ff8a80}}
body{font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:16px}
table{border-collapse:collapse;width:100%;overflow-x:auto;display:block}td,th{border-bottom:1px solid var(--line);padding:4px 8px;text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}.alert td{color:var(--bad);font-weight:600}.banner{padding:8px 12px;border:2px solid var(--bad);color:var(--bad);margin:12px 0}
</style></head><body><h1>Infrastructure cost (spec 14.2)</h1>
${t.alert ? `<p class="banner" role="alert">Projected cost ${usd(t.cost.perSubscriberMonth)} per heavy subscriber-month exceeds the $0.10 guardrail.</p>` : ''}
<p>Last ${d.hours.length} active hours: ${(t.rollup.playerMs / 3_600_000).toFixed(2)} player-hours, ${t.rollup.battles} battles.
Cost per player-hour ${usd(t.cost.perPlayerHour, 6)}; per heavy subscriber-month (60 h) <strong>${usd(t.cost.perSubscriberMonth)}</strong>
(guardrail $0.10: ${t.cost.withinGuardrail ? 'within' : 'exceeded'}); per battle ${usd(d.perBattle, 6)}; per zone-hour ${usd(d.perZoneHour, 6)}.</p>
<p>CPU time is modelled (2 ms per message, 50 ms per NPC move, 14.1); Analytics Engine holds the raw counters in production.</p>
<table><thead><tr><th>Hour (UTC)</th><th>Player-hours</th><th>Zone msgs</th><th>Battles</th><th>Battle msgs</th><th>Rows written</th><th>Cost</th><th>Per player-hour</th><th>Per subscriber-month</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export function worldRoutes(r: Router<Ctx>): void {
  r.add('POST', '/api/world/ticket', async (_req, ctx) => {
    const me = await requirePlay(ctx);
    const zone = entryZone(me.zoneId);
    const token = await signTicket(ctx.env.AUTH_SECRET, me.id, `zone:${zone}`, ctx.now);
    return json({
      zone,
      url: `/ws/zone/${encodeURIComponent(zone)}?t=${encodeURIComponent(token)}`,
    } satisfies WorldTicket);
  });

  r.add('GET', '/api/progress', async (_req, ctx) => {
    const me = await ctx.requireMe();
    const flags = factsFromFlags(await ctx.db.world.flags(me.id));
    const atCap = me.level >= CAPS.LEVEL_CAP;
    return json({
      level: me.level,
      // XP earned inside the current level and what the level needs (0 at the cap), for the bar.
      xp: atCap ? 0 : Math.max(0, me.xp - xpForLevel(me.level)),
      xpToNext: atCap ? 0 : xpToNext(me.level),
      totalXp: me.xp,
      coins: await ctx.db.world.coins(me.id),
      keyItems: await ctx.db.world.keyItems(me.id),
      quests: await storedQuests(ctx.db, me.id),
      lessonsDone: flags.lessonsDone,
    });
  });

  r.add('GET', '/api/admin/cost', async (req, ctx) => {
    await requireAdmin(ctx);
    const hours = Number(new URL(req.url).searchParams.get('hours')) || 24;
    return json(await dashboard(ctx.env, hours, ctx.now));
  });

  r.add('GET', '/admin/cost', async (req, ctx) => {
    await requireAdmin(ctx);
    const hours = Number(new URL(req.url).searchParams.get('hours')) || 24;
    return new Response(dashboardHtml(await dashboard(ctx.env, hours, ctx.now)), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  });
}
