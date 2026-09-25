/**
 * Metrics Durable Object (M5 5.5, 14.2): one instance (`global`) holding hourly usage rollups for the
 * cost dashboard. Zone channels post a telemetry window at most once a minute and battle rooms post
 * each finished battle, so it costs one storage row per report. When an hour closes with a projection
 * above the $0.10 guardrail it logs a `cost_guardrail` warning (Workers observability alerts on it).
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.ts';
import {
  HOUR_MS,
  addBattle,
  addZone,
  costDashboard,
  emptyRollup,
  hourOf,
  type BattleUsage,
  type Rollup,
  type ZoneReport,
} from '../metrics.ts';

const KEY = 'h:';
const pad = (t: number) => String(t).padStart(15, '0');
/** Rollups older than this are dropped (Analytics Engine keeps the long history in production). */
export const KEEP_HOURS = 24 * 14;

export function metricsStub(env: Env): DurableObjectStub {
  return env.METRICS.get(env.METRICS.idFromName('global'));
}

export class Metrics extends DurableObject<Env> {
  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    switch (`${req.method} ${url.pathname}`) {
      case 'POST /zone': {
        const rep = (await req.json()) as ZoneReport;
        await this.update(rep.to, (r) => addZone(r, rep));
        return new Response('ok');
      }
      case 'POST /battle': {
        const b = (await req.json()) as BattleUsage;
        await this.update(b.at, (r) => addBattle(r, b));
        return new Response('ok');
      }
      case 'GET /dashboard': {
        const hours = Math.max(
          1,
          Math.min(KEEP_HOURS, Number(url.searchParams.get('hours')) || 24),
        );
        const now = Number(url.searchParams.get('now')) || Date.now();
        const from = hourOf(now) - (hours - 1) * HOUR_MS;
        const list = await this.ctx.storage.list<Rollup>({ start: `${KEY}${pad(from)}` });
        return Response.json(costDashboard([...list.values()]));
      }
      default:
        return new Response('not found', { status: 404 });
    }
  }

  private async update(at: number, f: (r: Rollup) => void): Promise<void> {
    const hour = hourOf(Number.isFinite(at) ? at : Date.now());
    const key = `${KEY}${pad(hour)}`;
    const stored = await this.ctx.storage.get<Rollup>(key);
    const r = stored ?? emptyRollup(hour);
    f(r);
    await this.ctx.storage.put(key, r);
    if (!stored) await this.closeHour(hour - HOUR_MS);
  }

  /** The previous hour is complete: check it against the guardrail and prune old hours. */
  private async closeHour(hour: number): Promise<void> {
    const prev = await this.ctx.storage.get<Rollup>(`${KEY}${pad(hour)}`);
    if (prev) {
      const d = costDashboard([prev]);
      if (d.total.alert)
        console.warn(
          JSON.stringify({
            alert: 'cost_guardrail',
            hour: new Date(hour).toISOString(),
            perSubscriberMonth: d.total.cost.perSubscriberMonth,
            perPlayerHour: d.total.cost.perPlayerHour,
          }),
        );
    }
    const old = await this.ctx.storage.list({
      end: `${KEY}${pad(hour - KEEP_HOURS * HOUR_MS)}`,
      limit: 128,
    });
    if (old.size > 0) await this.ctx.storage.delete([...old.keys()]);
  }
}
