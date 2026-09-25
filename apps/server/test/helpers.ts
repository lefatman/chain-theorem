/** Helpers for Worker integration tests: a signed-in account and a socket that records messages. */
import { SELF } from 'cloudflare:test';
import type { ConsoleMailSender } from '../src/auth/mail.ts';
import { mailer } from '../src/api/auth.ts';
import type { Env } from '../src/env.ts';

export const BASE = 'http://localhost';

export async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ status: number; data: T; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

let counter = 0;

/** Sign up a new account through the real magic-link flow; returns its session cookie. */
export async function signUp(
  env: Env,
  name: string,
  dob = '2000-01-01',
  emailOverride?: string,
): Promise<{ cookie: string; id: string; email: string }> {
  const email = emailOverride ?? `${name.toLowerCase()}-${++counter}-${Date.now()}@example.com`;
  const start = await call('POST', '/api/auth/start', { email });
  if (start.status !== 200) throw new Error(`start ${start.status}`);
  const sent = (mailer(env) as ConsoleMailSender).sent;
  const mail = [...sent].reverse().find((m) => m.to === email);
  const token = mail ? decodeURIComponent(/token=([^\s&]+)/.exec(mail.text)?.[1] ?? '') : '';
  const verify = await call<{ status: string; signup: string }>('POST', '/api/auth/verify', {
    token,
  });
  if (verify.data.status !== 'needs_profile')
    throw new Error(`verify ${JSON.stringify(verify.data)}`);
  const done = await call<{ me: { id: string } }>('POST', '/api/auth/complete', {
    signup: verify.data.signup,
    name,
    dob,
  });
  const cookie = (done.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  if (!cookie) throw new Error(`complete ${done.status} ${JSON.stringify(done.data)}`);
  return { cookie, id: done.data.me.id, email };
}

export interface Sock {
  ws: WebSocket;
  msgs: { t: string; d: Record<string, unknown> }[];
  send(t: string, d?: unknown): void;
  /** Wait for the n-th (default first) message of type `t` received after index `from`. */
  wait(
    t: string,
    from?: number,
    timeoutMs?: number,
  ): Promise<{ t: string; d: Record<string, unknown> }>;
  closed: Promise<number>;
}

export async function openSocket(path: string): Promise<Sock> {
  const res = await SELF.fetch(`${BASE}${path}`, { headers: { upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`no websocket: ${res.status} ${await res.text()}`);
  ws.accept();
  const msgs: Sock['msgs'] = [];
  let closedResolve: (code: number) => void = () => undefined;
  const closed = new Promise<number>((r) => (closedResolve = r));
  ws.addEventListener('message', (e) => {
    msgs.push(JSON.parse(String(e.data)) as Sock['msgs'][number]);
  });
  ws.addEventListener('close', (e) => {
    closedResolve(e.code);
  });
  let seq = 0;
  return {
    ws,
    msgs,
    closed,
    send: (t, d = {}) => ws.send(JSON.stringify({ t, s: seq++, d })),
    async wait(t, from = 0, timeoutMs = 5000) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const m = msgs.slice(from).find((x) => x.t === t);
        if (m) return m;
        if (Date.now() > until)
          throw new Error(`timed out waiting for ${t}; got ${msgs.map((x) => x.t).join(',')}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
  };
}
