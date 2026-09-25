/**
 * Passwordless sign-in (M4 4.1): email → magic link (printed in the `pnpm dev` console locally) →
 * `#/login?token=…` verifies it; a new account then gives a display name and date of birth. Only the
 * date the account turns 18 is stored (R-SEC-011); the minimum age is 13 or the local age of digital
 * consent (DD-06).
 */
import { useEffect, useState } from 'preact/hooks';
import { go, route } from '../app/router.ts';
import { ApiError, api } from '../net/api.ts';
import { account, setSignedIn } from '../state/account.ts';

const MESSAGES: Record<string, string> = {
  invalid_token: 'That link is invalid, already used or expired. Ask for a new one.',
  too_young: 'Sorry, you are below the minimum age for an account in your country.',
  bad_date: 'Please enter a real date of birth.',
  bad_request: 'Please check the form.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  offline: 'The server cannot be reached. Local play still works.',
  no_server: 'This build runs without a server. Local play still works.',
};

function message(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'error';
  return MESSAGES[code] ?? `Something went wrong (${code}).`;
}

export function LoginScreen() {
  const params = route.value.params;
  const token = params.get('token');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [signup, setSignup] = useState<string | null>(params.get('signup'));
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    api.providers().then(
      (p) => setProviders(p.providers),
      () => setProviders([]),
    );
  }, []);

  useEffect(() => {
    if (!token) return;
    setBusy(true);
    api
      .verify(token)
      .then((r) => {
        if (r.status === 'signed_in') {
          setSignedIn(r.me);
          go('online');
        } else setSignup(r.signup);
      })
      .catch((e: unknown) => setError(message(e)))
      .finally(() => setBusy(false));
  }, [token]);

  if (account.value.kind === 'signed_in' && !signup) {
    return (
      <main class="setup">
        <h2>Signed in</h2>
        <p>You are signed in as {account.value.me.name}.</p>
        <button class="primary" onClick={() => go('online')}>
          Play online
        </button>
      </main>
    );
  }

  const submitEmail = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.startSignIn(email);
      setSent(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const submitProfile = async (e: Event) => {
    e.preventDefault();
    if (!signup) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.complete(signup, name, dob);
      setSignedIn(r.me);
      go('online');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="setup">
      <h2>{signup ? 'Create your account' : 'Sign in'}</h2>
      {error && (
        <p class="note warn" role="alert">
          {error}
        </p>
      )}
      {signup ? (
        <form onSubmit={submitProfile}>
          <label>
            Display name
            <input
              value={name}
              required
              minLength={2}
              maxLength={24}
              autoComplete="nickname"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            Date of birth
            <input
              type="date"
              value={dob}
              required
              onInput={(e) => setDob((e.target as HTMLInputElement).value)}
            />
          </label>
          <p class="note">
            We keep only the date you turn 18 (for chat safety), never your birth date.
          </p>
          <button class="primary" type="submit" disabled={busy}>
            Create account
          </button>
        </form>
      ) : token && busy ? (
        <p>Checking your link…</p>
      ) : sent ? (
        <p role="status">
          Check your email for a sign-in link. It works once and expires in 15 minutes. (Running
          locally? The link is printed in the <code>pnpm dev</code> console.)
        </p>
      ) : (
        <form onSubmit={submitEmail}>
          <label>
            Email
            <input
              type="email"
              value={email}
              required
              autoComplete="email"
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />
          </label>
          <button class="primary" type="submit" disabled={busy}>
            Email me a sign-in link
          </button>
          {providers.map((p) => (
            <a class="button" key={p} href={`/api/auth/oauth/${p}/start`}>
              Continue with {p[0]?.toUpperCase()}
              {p.slice(1)}
            </a>
          ))}
        </form>
      )}
      <button onClick={() => go('title')}>Back</button>
    </main>
  );
}
