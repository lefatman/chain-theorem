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
import { AccountScreen, SubscribeRequired } from '../ui/AccountScreen.tsx';
import { account } from '../state/account.ts';

// The overworld (M5) is its own lazy chunk; its Phaser scene is a further lazy chunk (12.3).
const WorldScreen = lazy(() =>
  import('../ui/world/WorldScreen.tsx').then((m) => ({ default: m.WorldScreen })),
);

// M6 leaderboards and guild screens load on demand (12.3 bundle budget).
const LeaderboardsScreen = lazy(() =>
  import('../ui/LeaderboardsScreen.tsx').then((m) => ({ default: m.LeaderboardsScreen })),
);
const GuildScreen = lazy(() =>
  import('../ui/GuildScreen.tsx').then((m) => ({ default: m.GuildScreen })),
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
    case 'world': {
      // The trial or subscription has ended: the world is refused (402), so say so (M6 6.3).
      const acc = account.value;
      screen =
        acc.kind === 'signed_in' && !acc.me.access.canPlay ? (
          <SubscribeRequired access={acc.me.access} />
        ) : (
          <WorldScreen />
        );
      break;
    }
    case 'account':
      screen = <AccountScreen />;
      break;
    case 'leaderboards':
      screen = <LeaderboardsScreen />;
      break;
    case 'guild':
      screen = <GuildScreen />;
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
