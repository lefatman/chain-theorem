/** The guild screen (M6 6.1, spec 10.4): the guild panel outside the world, from the online screen. */
import { useEffect } from 'preact/hooks';
import { go } from '../app/router.ts';
import { account, refreshAccount } from '../state/account.ts';
import { GuildPanel } from './GuildPanel.tsx';

export function GuildScreen() {
  const acc = account.value;
  useEffect(() => {
    if (acc.kind === 'unknown') void refreshAccount();
  }, [acc.kind]);
  return (
    <main class="setup">
      <h2>Guild</h2>
      {acc.kind === 'signed_in' ? (
        <GuildPanel me={acc.me.id} />
      ) : (
        <p>{acc.kind === 'unknown' ? 'Connecting…' : 'Sign in to join a guild.'}</p>
      )}
      <p class="muted small-text">Guild chat is in the world: open the Chat panel's Guild tab.</p>
      <div class="row start">
        <button onClick={() => go('world')}>Enter the world</button>
        <button onClick={() => go('online')}>Back</button>
      </div>
    </main>
  );
}
