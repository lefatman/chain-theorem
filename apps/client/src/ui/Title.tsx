import { go } from '../app/router.ts';

export function Title() {
  return (
    <main class="title">
      <h1>Chain Theorem</h1>
      <p class="tagline">Chess, bent by capture-triggered abilities.</p>
      <nav class="menu">
        <button onClick={() => go('play')}>Play a local battle</button>
        <button onClick={() => go('loadouts')}>Loadouts</button>
        <button onClick={() => go('settings')}>Settings</button>
        {import.meta.env.DEV && <button onClick={() => go('lab')}>Scenario Lab (dev)</button>}
      </nav>
    </main>
  );
}
