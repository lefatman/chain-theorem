import { go } from '../app/router.ts';
import { activeBattle } from './battleSession.ts';
import { account } from '../state/account.ts';

export function Title() {
  const battle = activeBattle.value;
  const resumable = battle !== null && battle.snapshot.value.status !== 'ended';
  return (
    <main class="title">
      <div>
        <h1>Chain Theorem</h1>
        <p class="tagline">Chess, bent by capture-triggered abilities.</p>
        <nav class="menu" aria-label="Main menu">
          {resumable && (
            <button class="primary" onClick={() => go('battle')}>
              Resume battle
            </button>
          )}
          <button class={resumable ? '' : 'primary'} onClick={() => go('play')}>
            Play a local battle
          </button>
          {account.value.kind !== 'offline' && (
            <button onClick={() => go('online')}>
              {account.value.kind === 'signed_in' ? 'Play online' : 'Play online (sign in)'}
            </button>
          )}
          <button onClick={() => go('loadouts')}>Loadouts</button>
          <button onClick={() => go('settings')}>Settings</button>
          {import.meta.env.DEV && <button onClick={() => go('lab')}>Scenario Lab (dev)</button>}
        </nav>
      </div>
    </main>
  );
}
