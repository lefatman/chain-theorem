/** App shell: routes between the title screen, local play, loadouts, settings and dev tools. */
import { lazy, Suspense } from 'preact/compat';
import { route } from './router.ts';
import { Title } from '../ui/Title.tsx';
import { PlaySetup } from '../ui/PlaySetup.tsx';
import { BattleScreen } from '../ui/BattleScreen.tsx';
import { LoadoutsScreen } from '../ui/LoadoutsScreen.tsx';
import { SettingsScreen } from '../ui/SettingsScreen.tsx';
import { LoginScreen } from '../ui/LoginScreen.tsx';
import { OnlineScreen } from '../ui/OnlineScreen.tsx';

// The overworld (M5) is its own lazy chunk; its Phaser scene is a further lazy chunk (12.3).
const WorldScreen = lazy(() =>
  import('../ui/world/WorldScreen.tsx').then((m) => ({ default: m.WorldScreen })),
);

// Dev-only Scenario Lab: this branch is removed from production builds (BUILD_PROMPT M3).
const ScenarioLab = import.meta.env.DEV
  ? lazy(() => import('../lab/ScenarioLab.tsx').then((m) => ({ default: m.ScenarioLab })))
  : null;

export function App() {
  const r = route.value;
  let screen;
  switch (r.name) {
    case 'play':
      screen = <PlaySetup />;
      break;
    case 'battle':
      screen = <BattleScreen />;
      break;
    case 'loadouts':
      screen = <LoadoutsScreen />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    case 'login':
      screen = <LoginScreen />;
      break;
    case 'online':
      screen = <OnlineScreen />;
      break;
    case 'world':
      screen = <WorldScreen />;
      break;
    case 'lab':
      screen = ScenarioLab ? <ScenarioLab /> : <Title />;
      break;
    default:
      screen = <Title />;
  }
  return (
    <div class="app">
      <Suspense fallback={<p class="loading">Loading…</p>}>{screen}</Suspense>
    </div>
  );
}
