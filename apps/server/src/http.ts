/** Small HTTP helpers for the Worker's REST routes (ARCHITECTURE 6). */
import type { z } from 'zod';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function noContent(headers: HeadersInit = {}): Response {
  return new Response(null, { status: 204, headers });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.code }, e.status);
  console.error('unhandled', e);
  return json({ error: 'internal' }, 500);
}

/** Parse a JSON body with a schema; 400 on anything invalid (R-SEC-002). */
export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > 64 * 1024) throw new HttpError(413, 'too_large');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'bad_request');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, 'bad_request');
  return r.data;
}

/**
 * CSRF guard for state-changing requests: the Origin header must be the app's own origin
 * (SameSite=Lax cookies already block most cross-site POSTs; this closes the rest).
 */
export function checkOrigin(req: Request, appOrigin: string): void {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  const self = new URL(req.url).origin;
  if (origin !== null && origin !== appOrigin && origin !== self)
    throw new HttpError(403, 'bad_origin');
}

export type Handler<C> = (
  req: Request,
  ctx: C,
  params: Record<string, string>,
) => Promise<Response>;

/** A tiny router: `add('POST', '/api/battles/:id/ticket', h)`. */
export class Router<C> {
  private readonly routes: { method: string; parts: string[]; h: Handler<C> }[] = [];
  add(method: string, path: string, h: Handler<C>): this {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), h });
    return this;
  }
  match(
    method: string,
    pathname: string,
  ): { h: Handler<C>; params: Record<string, string> } | null {
    const segs = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i] as string;
        const s = segs[i] as string;
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(s);
        else if (p !== s) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { h: r.h, params };
    }
    if (pathMatched) throw new HttpError(405, 'method_not_allowed');
    return null;
  }
}
