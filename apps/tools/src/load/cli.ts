/**
 * `pnpm test:load` (M5 done-when, spec 14.2 R-COST-002): N bot clients (default 50) in one zone of the
 * real Worker (`wrangler dev`) walk and chat for a while; the tool measures the socket traffic and
 * step fan-out latency and prints the projected infrastructure cost per player-hour and per heavy
 * subscriber-month with the spec 14.1 rates, failing when it exceeds the $0.10 guardrail.
 *
 *   pnpm test:load [--bots 50] [--seconds 60] [--rate 1]   (rate = messages per bot per second)
 *
 * Two cost views must both stay inside the guardrail: the client-side estimate from the traffic the
 * bots saw (conservative: the zone is assumed awake for the whole run, no hibernation credit), and
 * the server's own telemetry as the cost dashboard shows it (`/api/admin/cost`, DD-81).
 */
import { readFileSync } from 'node:fs';
import {
  ClientZone,
  GUARDRAIL_PER_SUBSCRIBER,
  ServerZone,
  cost,
  decode,
  encode,
  type Msg,
} from '@chain-theorem/protocol';
import { parseZone, stepFrom, walkable, world } from '@chain-theorem/content/world';
import { signUp, startWorker } from '../lib/worker.ts';

const ADMIN = 'admin@load.test';

interface Dashboard {
  total: {
    rollup: { playerMs: number; zoneIn: number; rowsWritten: number; doRequests: number };
    cost: { perPlayerHour: number; perSubscriberMonth: number; withinGuardrail: boolean };
  };
  perZoneHour: number;
}

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : def;
};
const BOTS = arg('bots', 50);
const SECONDS = arg('seconds', 60);
const RATE = arg('rate', 1);
const DIRS = ['n', 's', 'e', 'w'] as const;

interface Bot {
  id: string;
  ws: WebSocket;
  x: number;
  y: number;
  sent: number;
  received: number;
  byType: Map<string, number>;
}

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
}

async function main(): Promise<void> {
  console.log(`load: starting the Worker; ${BOTS} bots for ${SECONDS} s at ${RATE} msg/s each`);
  const w = await startWorker({ vars: { ADMIN_EMAILS: ADMIN } });
  const bots: Bot[] = [];
  const stepSent = new Map<string, number>(); // `${id}:${x},${y}` -> time the step was sent
  const fanout: number[] = [];
  let zoneId = '';
  try {
    const t0 = Date.now();
    for (let i = 0; i < BOTS; i++) {
      const acc = await signUp(w, `bot${i}-${t0}@load.test`, `Bot ${i}`);
      const ticket = (await (
        await fetch(`${w.origin}/api/world/ticket`, {
          method: 'POST',
          headers: { cookie: acc.cookie },
        })
      ).json()) as { zone: string; url: string };
      zoneId = ticket.zone;
      const ws = new WebSocket(`${w.origin.replace('http', 'ws')}${ticket.url}`);
      const bot: Bot = { id: acc.id, ws, x: 0, y: 0, sent: 0, received: 0, byType: new Map() };
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('socket failed'));
      });
      ws.onmessage = (ev) => {
        const m = decode(ServerZone, ev.data, Number.POSITIVE_INFINITY);
        if (!m) return;
        bot.received++;
        bot.byType.set(m.t, (bot.byType.get(m.t) ?? 0) + 1);
        if (m.t === 'zsnap') {
          bot.x = m.d.you.x;
          bot.y = m.d.you.y;
        } else if (m.t === 'zpos') {
          bot.x = m.d.x;
          bot.y = m.d.y;
        } else if (m.t === 'zstep') {
          const sentAt = stepSent.get(`${m.d.p}:${m.d.x},${m.d.y}`);
          if (sentAt !== undefined && fanout.length < 20_000) fanout.push(Date.now() - sentAt);
        }
      };
      const send = (msg: Msg<typeof ClientZone>) => {
        ws.send(encode(ClientZone, msg));
        bot.sent++;
      };
      send({ t: 'hello', d: {} });
      bots.push(bot);
    }
    console.log(
      `load: ${bots.length} bots connected to ${zoneId} in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
    const zone = world.zones.find((z) => z.id === zoneId);
    if (!zone) throw new Error(`unknown zone ${zoneId}`);
    const geo = parseZone(zone.map);
    // Like players on paths: no wild grass, and no warps (a warp would move the bot to another zone).
    const warp = new Set(geo.warps.map((x) => `${x.x},${x.y}`));

    // Walk (avoiding wild grass, like players on paths) and chat now and then.
    const start = Date.now();
    const timers = bots.map((bot, i) =>
      setInterval(
        () => {
          if (Date.now() - start > SECONDS * 1000) return;
          const send = (msg: Msg<typeof ClientZone>) => {
            if (bot.ws.readyState !== WebSocket.OPEN) return;
            bot.ws.send(encode(ClientZone, msg));
            bot.sent++;
          };
          if (Math.random() < 0.03) {
            send({ t: 'chat', d: { ch: 'zone', text: `hello from bot ${i}` } });
            return;
          }
          const dirs = DIRS.filter((d) => {
            const n = stepFrom(bot.x, bot.y, d);
            return (
              walkable(geo, n.x, n.y) &&
              geo.wild[n.y * geo.width + n.x] === 0 &&
              !warp.has(`${n.x},${n.y}`)
            );
          });
          const d = dirs[Math.floor(Math.random() * dirs.length)];
          if (!d) {
            // Boxed in (a crowd, a wall): a step into a blocked tile only turns (still 1 message).
            send({ t: 'step', d: { dir: DIRS[Math.floor(Math.random() * 4)] ?? 'n' } });
            return;
          }
          const n = stepFrom(bot.x, bot.y, d);
          bot.x = n.x;
          bot.y = n.y;
          stepSent.set(`${bot.id}:${n.x},${n.y}`, Date.now());
          send({ t: 'step', d: { dir: d } });
        },
        Math.max(50, 1000 / RATE),
      ),
    );
    await new Promise((r) => setTimeout(r, SECONDS * 1000 + 1500));
    for (const t of timers) clearInterval(t);
    for (const b of bots) b.ws.close(1000, 'done');
    await new Promise((r) => setTimeout(r, 1000));

    const sent = bots.reduce((n, b) => n + b.sent, 0);
    const received = bots.reduce((n, b) => n + b.received, 0);
    const playerHours = (BOTS * SECONDS) / 3600;
    const report = cost({
      playerHours,
      wsIncoming: sent,
      // Upgrades and one position/presence write burst per bot on join and leave.
      doRequests: BOTS * 2,
      gbSeconds: SECONDS * 0.128,
      rowsWritten: BOTS * 4,
      workerRequests: BOTS * 6,
    });
    const snaps = bots.filter((b) => (b.byType.get('zsnap') ?? 0) > 0).length;
    // The server's view: the zone reported its telemetry when the last bot left (DD-81).
    const admin = await signUp(w, ADMIN, 'Load Admin', '1980-01-01');
    let server: Dashboard | null = null;
    for (let i = 0; i < 20 && !(server && server.total.rollup.playerMs > 0); i++) {
      const res = await fetch(`${w.origin}/api/admin/cost?hours=2`, {
        headers: { cookie: admin.cookie },
      });
      server = res.ok ? ((await res.json()) as Dashboard) : null;
      if (!(server && server.total.rollup.playerMs > 0))
        await new Promise((r) => setTimeout(r, 500));
    }
    console.log(
      JSON.stringify(
        {
          bots: BOTS,
          seconds: SECONDS,
          zone: zoneId,
          connected: snaps,
          messagesSent: sent,
          messagesReceived: received,
          perBotPerSecondIn: +(sent / BOTS / SECONDS).toFixed(2),
          perBotPerSecondOut: +(received / BOTS / SECONDS).toFixed(2),
          fanoutMs: { p50: pct(fanout, 50), p95: pct(fanout, 95), samples: fanout.length },
          cost: {
            perPlayerHour: +report.perPlayerHour.toFixed(6),
            perSubscriberMonth: +report.perSubscriberMonth.toFixed(4),
            guardrail: GUARDRAIL_PER_SUBSCRIBER,
            breakdown: report.breakdown,
          },
          serverTelemetry: server
            ? {
                playerHours: +(server.total.rollup.playerMs / 3_600_000).toFixed(3),
                zoneMessagesIn: server.total.rollup.zoneIn,
                rowsWritten: server.total.rollup.rowsWritten,
                doRequests: server.total.rollup.doRequests,
                perPlayerHour: +server.total.cost.perPlayerHour.toFixed(6),
                perSubscriberMonth: +server.total.cost.perSubscriberMonth.toFixed(4),
                perZoneHour: +server.perZoneHour.toFixed(6),
              }
            : null,
        },
        null,
        2,
      ),
    );
    const serverOk =
      server !== null && server.total.rollup.playerMs > 0 && server.total.cost.withinGuardrail;
    const ok = snaps === BOTS && report.withinGuardrail && serverOk && fanout.length > 0;
    console.log(
      ok
        ? `load ok: ${BOTS} clients in one zone, $${report.perSubscriberMonth.toFixed(4)} (bots) and $${server?.total.cost.perSubscriberMonth.toFixed(4)} (server telemetry) per heavy subscriber-month (guardrail $${GUARDRAIL_PER_SUBSCRIBER})`
        : 'load FAILED',
    );
    if (!ok) {
      const lines = readFileSync(w.log, 'utf8').trim().split('\n');
      console.log(`load: last lines of the Worker log:\n${lines.slice(-40).join('\n')}`);
    }
    process.exitCode = ok ? 0 : 1;
  } finally {
    await w.stop();
  }
}

await main();
