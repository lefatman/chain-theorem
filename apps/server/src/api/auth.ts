/**
 * Sign-in routes (M4 4.1, R-SEC-006): magic links, sign-up completion, OAuth, sign-out. Answers never
 * reveal whether an email has an account (the link itself decides).
 */
import { AuthStart, AuthVerify, IsoDate } from '@chain-theorem/protocol';
import { z } from 'zod';
import type { Player } from '@chain-theorem/db';
import { checkAge } from '../auth/age.ts';
import { TRIAL_MS } from '../billing/entitlement.ts';
import { parseCookies, serializeCookie, SESSION_TTL_MS } from '../auth/cookies.ts';
import { ConsoleMailSender, HttpMailSender, magicLinkMail, type MailSender } from '../auth/mail.ts';
import {
  PROVIDERS,
  checkState,
  finishOAuth,
  startOAuth,
  type OAuthKeys,
  type ProviderId,
} from '../auth/oauth.ts';
import type { Env } from '../env.ts';
import { HttpError, body, json, noContent, type Router } from '../http.ts';
import { signTicket } from '../auth/tickets.ts';
import {
  DATA_ROOM,
  DATA_TOKEN_TTL_MS,
  SUSPENDED,
  suspensionView,
} from '../moderation/sanctions.ts';
import { grantStarterCollection } from './collection.ts';
import { publicMe, secureCookies, sessionCookie, type Ctx } from './context.ts';

export const LOGIN_TTL_MS = 15 * 60_000;
const SIGNUP_TTL_MS = 30 * 60_000;
/** Magic links per email per 15 minutes. */
const LINKS_PER_WINDOW = 5;
const OAUTH_COOKIE = 'ct_oauth';

const console_ = new ConsoleMailSender();
export function mailer(env: Env): MailSender {
  if (env.MAIL_MODE === 'http' && env.MAIL_ENDPOINT && env.MAIL_API_KEY && env.MAIL_FROM)
    return new HttpMailSender(env.MAIL_ENDPOINT, env.MAIL_API_KEY, env.MAIL_FROM);
  return console_;
}

export function oauthKeys(env: Env, p: ProviderId): OAuthKeys | null {
  const id = {
    github: env.GITHUB_CLIENT_ID,
    google: env.GOOGLE_CLIENT_ID,
    discord: env.DISCORD_CLIENT_ID,
  }[p];
  const secret = {
    github: env.GITHUB_CLIENT_SECRET,
    google: env.GOOGLE_CLIENT_SECRET,
    discord: env.DISCORD_CLIENT_SECRET,
  }[p];
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

const Complete = z.object({
  signup: z.string().min(16).max(128),
  name: z.string().trim().min(2).max(24),
  dob: IsoDate,
});

/** A 15-minute token for the suspended player's own data export and deletion (R-SEC-010). */
function dataToken(ctx: Ctx, player: Player): Promise<string> {
  return signTicket(ctx.env.AUTH_SECRET, player.id, DATA_ROOM, ctx.now, DATA_TOKEN_TTL_MS);
}

async function signIn(ctx: Ctx, player: Player): Promise<Response> {
  // M6 6.4 (R-SEC-006): a suspended account cannot sign in; it is told until when, never why here.
  const suspended = suspensionView(player, ctx.now);
  if (suspended)
    return json(
      { error: SUSPENDED, until: suspended.until, data: await dataToken(ctx, player) },
      403,
    );
  const { token } = await ctx.db.sessions.create(player.id, {
    ttlMs: SESSION_TTL_MS,
    now: ctx.now,
  });
  return json({ status: 'signed_in', me: publicMe(player, ctx.now) }, 200, {
    'set-cookie': sessionCookie(ctx.env, token),
  });
}

async function issueSignup(
  ctx: Ctx,
  email: string,
  oauth?: { provider: string; providerUserId: string },
): Promise<string> {
  const { token } = await ctx.db.loginTokens.issue({
    email,
    purpose: 'signup',
    ttlMs: SIGNUP_TTL_MS,
    now: ctx.now,
    ...(oauth ? { data: { oauth } } : {}),
  });
  return token;
}

export function authRoutes(r: Router<Ctx>): void {
  r.add('POST', '/api/auth/start', async (req, ctx) => {
    const { email } = await body(req, AuthStart);
    const recent = await ctx.db.loginTokens.countIssuedSince(email, ctx.now - LOGIN_TTL_MS);
    if (recent >= LINKS_PER_WINDOW) throw new HttpError(429, 'rate_limited');
    const { token } = await ctx.db.loginTokens.issue({
      email,
      purpose: 'login',
      ttlMs: LOGIN_TTL_MS,
      now: ctx.now,
    });
    const link = `${ctx.env.APP_ORIGIN}/#/login?token=${encodeURIComponent(token)}`;
    await mailer(ctx.env).send(magicLinkMail(email, link, LOGIN_TTL_MS / 60_000));
    return json({ ok: true });
  });

  r.add('POST', '/api/auth/verify', async (req, ctx) => {
    const { token } = await body(req, AuthVerify);
    const used = await ctx.db.loginTokens.consume(token, ctx.now, 'login');
    if (!used) throw new HttpError(400, 'invalid_token');
    const player = await ctx.db.players.getByEmail(used.email);
    if (player) return signIn(ctx, player);
    return json({ status: 'needs_profile', signup: await issueSignup(ctx, used.email) });
  });

  r.add('POST', '/api/auth/complete', async (req, ctx) => {
    const { signup, name, dob } = await body(req, Complete);
    // Check the age before spending the token, so a typo can be corrected (R-SEC-011, DD-06).
    const age = checkAge(dob, ctx.now, ctx.country);
    if (!age.ok) throw new HttpError(400, age.reason);
    const used = await ctx.db.loginTokens.consume(signup, ctx.now, 'signup');
    if (!used) throw new HttpError(400, 'invalid_token');
    let player = await ctx.db.players.getByEmail(used.email);
    if (!player) {
      player = await ctx.db.players.create({
        email: used.email,
        displayName: name,
        adultFrom: age.adultFrom,
        // 14.4 (COMMITTED): every new account starts a 7-day free trial with full play (R-COST-005).
        trialEndsAt: ctx.now + TRIAL_MS,
        now: ctx.now,
      });
      await grantStarterCollection(ctx.db, player.id);
    }
    const oauth = used.data.oauth;
    if (oauth) await ctx.db.oauthAccounts.link(player.id, oauth.provider, oauth.providerUserId);
    return signIn(ctx, player);
  });

  r.add('POST', '/api/auth/signout', async (_req, ctx) => {
    if (ctx.token) await ctx.db.sessions.delete(ctx.token);
    return noContent({ 'set-cookie': sessionCookie(ctx.env, '', 0) });
  });

  r.add('GET', '/api/auth/providers', async (_req, ctx) =>
    json({
      providers: (Object.keys(PROVIDERS) as ProviderId[]).filter(
        (p) => oauthKeys(ctx.env, p) !== null,
      ),
    }),
  );

  r.add('GET', '/api/auth/oauth/:p/start', async (_req, ctx, params) => {
    const p = PROVIDERS[params.p as ProviderId];
    const keys = p ? oauthKeys(ctx.env, p.id) : null;
    if (!p || !keys) throw new HttpError(404, 'not_found');
    const redirect = `${ctx.env.APP_ORIGIN}/api/auth/oauth/${p.id}/callback`;
    const { url, cookie } = await startOAuth(p, keys, redirect, ctx.env.AUTH_SECRET, ctx.now);
    const c = serializeCookie(OAUTH_COOKIE, cookie, {
      maxAgeMs: 10 * 60_000,
      secure: secureCookies(ctx.env),
      path: '/api/auth/oauth',
    });
    return new Response(null, { status: 302, headers: { location: url, 'set-cookie': c } });
  });

  r.add('GET', '/api/auth/oauth/:p/callback', async (req, ctx, params) => {
    const p = PROVIDERS[params.p as ProviderId];
    const keys = p ? oauthKeys(ctx.env, p.id) : null;
    if (!p || !keys) throw new HttpError(404, 'not_found');
    const url = new URL(req.url);
    const fail = () =>
      new Response(null, {
        status: 302,
        headers: { location: `${ctx.env.APP_ORIGIN}/#/login?error=oauth` },
      });
    const verifier = await checkState(
      p,
      url.searchParams.get('state') ?? '',
      parseCookies(req.headers.get('cookie')).get(OAUTH_COOKIE),
      ctx.env.AUTH_SECRET,
      ctx.now,
    );
    const code = url.searchParams.get('code');
    if (!verifier || !code) return fail();
    const redirect = `${ctx.env.APP_ORIGIN}/api/auth/oauth/${p.id}/callback`;
    const profile = await finishOAuth(p, keys, code, verifier, redirect);
    if (!profile) return fail();
    const linked = await ctx.db.oauthAccounts.findPlayerId(p.id, profile.id);
    const player = linked
      ? await ctx.db.players.getById(linked)
      : await ctx.db.players.getByEmail(profile.email);
    const clear = serializeCookie(OAUTH_COOKIE, '', {
      maxAgeMs: 0,
      secure: secureCookies(ctx.env),
      path: '/api/auth/oauth',
    });
    const headers = new Headers({ 'set-cookie': clear });
    if (player && suspensionView(player, ctx.now)) {
      const data = encodeURIComponent(await dataToken(ctx, player));
      headers.set('location', `${ctx.env.APP_ORIGIN}/#/login?error=suspended&data=${data}`);
    } else if (player) {
      if (!linked) await ctx.db.oauthAccounts.link(player.id, p.id, profile.id);
      const { token } = await ctx.db.sessions.create(player.id, {
        ttlMs: SESSION_TTL_MS,
        now: ctx.now,
      });
      headers.append('set-cookie', sessionCookie(ctx.env, token));
      headers.set('location', `${ctx.env.APP_ORIGIN}/#/online`);
    } else {
      const signup = await issueSignup(ctx, profile.email, {
        provider: p.id,
        providerUserId: profile.id,
      });
      headers.set('location', `${ctx.env.APP_ORIGIN}/#/login?signup=${encodeURIComponent(signup)}`);
    }
    return new Response(null, { status: 302, headers });
  });
}
