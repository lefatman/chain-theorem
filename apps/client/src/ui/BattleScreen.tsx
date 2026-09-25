import { activeBattle, battleSerial } from './battleSession.ts';
import { BattleView } from '../battle/BattleView.tsx';
import { go } from '../app/router.ts';

export function BattleScreen() {
  const c = activeBattle.value;
  if (!c) {
    return (
      <main class="setup">
        <p>No battle in progress.</p>
        <button class="primary" onClick={() => go('play')}>
          Set one up
        </button>
      </main>
    );
  }
  return <BattleView key={battleSerial.value} controller={c} />;
}
