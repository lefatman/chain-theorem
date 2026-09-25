/**
 * OAuth sign-in (M4 4.1): authorization code flow with PKCE and a signed state. A provider is
 * enabled only when its client id and secret exist (human-only keys, DEPLOY.md); without keys the
 * routes answer 404 and the client hides the button. Only verified email addresses are accepted.
 */
import { hmac, hmacVerify, randomToken, sha256 } from './crypto.ts';

export type ProviderId = 'github' | 'google' | 'discord';

export interface ProviderConfig {
  id: ProviderId;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Fetch the account id and a verified email with the access token; null if none is verified. */
  profile(accessToken: string): Promise<{ id: string; email: string } | null>;
}

async function getJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'user-agent': 'chain-theorem',
    },
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  github: {
    id: 'github',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    async profile(token) {
      const user = (await getJson('https://api.github.com/user', token)) as { id?: number };
      const emails = (await getJson('https://api.github.com/user/emails', token)) as {
        email: string;
        primary: boolean;
        verified: boolean;
      }[];
      const e = emails.find((x) => x.primary && x.verified);
      return user.id !== undefined && e ? { id: String(user.id), email: e.email } : null;
    },
  },
  google: {
    id: 'google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email',
    async profile(token) {
      const u = (await getJson('https://openidconnect.googleapis.com/v1/userinfo', token)) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
      };
      return u.sub && u.email && u.email_verified ? { id: u.sub, email: u.email } : null;
    },
  },
  discord: {
    id: 'discord',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    async profile(token) {
      const u = (await getJson('https://discord.com/api/users/@me', token)) as {
        id?: string;
        email?: string;
        verified?: boolean;
      };
      return u.id && u.email && u.verified ? { id: u.id, email: u.email } : null;
    },
  },
};

export interface OAuthKeys {
  clientId: string;
  clientSecret: string;
}

export const STATE_TTL_MS = 10 * 60_000;

/**
 * Start a sign-in: the redirect URL plus a cookie value holding the PKCE verifier. The state
 * parameter is signed and expires, binding the callback to this browser's cookie.
 */
export async function startOAuth(
  p: ProviderConfig,
  keys: OAuthKeys,
  redirectUri: string,
  secret: string,
  now: number,
): Promise<{ url: string; cookie: string }> {
  const verifier = randomToken(32);
  const challenge = await sha256(verifier);
  const nonce = randomToken(16);
  const body = `${p.id}.${nonce}.${now + STATE_TTL_MS}`;
  const state = `${body}.${await hmac(secret, `oauth.${body}`)}`;
  const q = new URLSearchParams({
    client_id: keys.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${p.authorizeUrl}?${q.toString()}`, cookie: `${nonce}.${verifier}` };
}

/** Check the callback's state against the cookie; returns the PKCE verifier when valid. */
export async function checkState(
  p: ProviderConfig,
  state: string,
  cookie: string | undefined,
  secret: string,
  now: number,
): Promise<string | null> {
  const parts = state.split('.');
  if (parts.length !== 4 || !cookie) return null;
  const [id, nonce, exp, sig] = parts as [string, string, string, string];
  if (id !== p.id || !(await hmacVerify(secret, `oauth.${id}.${nonce}.${exp}`, sig))) return null;
  if (!(Number(exp) >= now)) return null;
  const [cNonce, verifier] = cookie.split('.');
  if (cNonce !== nonce || !verifier) return null;
  return verifier;
}

/** Exchange the code for an access token and read the verified profile. */
export async function finishOAuth(
  p: ProviderConfig,
  keys: OAuthKeys,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<{ id: string; email: string } | null> {
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: keys.clientId,
      client_secret: keys.clientSecret,
      code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) return null;
  const tok = (await res.json()) as { access_token?: string };
  if (!tok.access_token) return null;
  const profile = await p.profile(tok.access_token);
  return profile ? { id: profile.id, email: profile.email.toLowerCase() } : null;
}
