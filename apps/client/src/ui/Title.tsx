/**
 * The title page: the pitch, the ways to play, and the alpha call to action when the server offers
 * guest play (spec 9.6; shown only then, so a build without the flag shows nothing of it). Local play
 * works without any server (M3); the online entries hide when no Worker answers.
 */
import { useEffect } from 'preact/hooks';
import { go } from '../app/router.ts';
import { activeBattle } from './battleSession.ts';
import { account } from '../state/account.ts';
import { alphaEnabled, refreshAlpha } from '../state/alpha.ts';
import { worldSession } from '../world/session.ts';

export function Title() {
  const battle = activeBattle.value;
  const resumable = battle !== null && battle.snapshot.value.status !== 'ended';
  const online = account.value.kind !== 'offline';
  useEffect(() => {
    if (online && alphaEnabled.value === null) void refreshAlpha();
  }, [online]);
  return (
    <main class="title">
      <section class="hero">
        <h1>Chain Theorem</h1>
        <p class="tagline">Chess, bent by capture-triggered abilities.</p>
        <p class="pitch">
          Every piece carries abilities that fire when it captures or is captured. Build an army
          from six elements, read your opponent's hidden kit, and win the chain.
        </p>
      </section>
      {online && alphaEnabled.value === true && (
        <section class="cta" aria-label="Alpha test">
          <h2>Alpha test: play a friend by code</h2>
          <p>
            No account needed. One of you creates a one-time code at a level you choose, with every
            card and item at or below it; the other opens the code. Nothing is recorded.
          </p>
          <button class="primary big" onClick={() => go('alpha')}>
            Play a friend by code
          </button>
        </section>
      )}
      <nav class="menu" aria-label="Main menu">
        {resumable && (
          <button class="primary" onClick={() => go('battle')}>
            Resume battle
          </button>
        )}
        {worldSession.value && (
          <button class={resumable ? '' : 'primary'} onClick={() => go('world')}>
            Return to the world
          </button>
        )}
        <button class={resumable ? '' : 'primary'} onClick={() => go('play')}>
          Play a local battle
        </button>
        {online && (
          <button onClick={() => go('online')}>
            {account.value.kind === 'signed_in' ? 'Play online' : 'Play online (sign in)'}
          </button>
        )}
        <button onClick={() => go('loadouts')}>Loadouts</button>
        <button onClick={() => go('settings')}>Settings</button>
        {import.meta.env.DEV && <button onClick={() => go('lab')}>Scenario Lab (dev)</button>}
      </nav>
      <section class="how" aria-label="How it plays">
        <div>
          <h3>Chess underneath</h3>
          <p>
            Every chess rule holds: checks, castling, promotion, the clock. First Blood ends at the
            first piece taken; Full Battle at mate.
          </p>
        </div>
        <div>
          <h3>Abilities on capture</h3>
          <p>
            Capturing and being captured trigger your pieces' hidden abilities, in chains up to
            three deep. The log shows every step.
          </p>
        </div>
        <div>
          <h3>Six elements</h3>
          <p>
            Each element has a trait and a signature card. Capture your foil and its triggers fall
            silent; build to cover the matchup.
          </p>
        </div>
      </section>
      <p class="fine muted">Alpha build. Rules, cards and numbers are still changing.</p>
    </main>
  );
}
