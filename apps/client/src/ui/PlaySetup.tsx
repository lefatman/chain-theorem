/** Local battle setup (M3 done-when): any format, any NPC tier or hot-seat, any saved loadout. */
import { useState } from 'preact/hooks';
import { FORMATS } from '@chain-theorem/content';
import type { FormatId } from '@chain-theorem/rules';
import { go } from '../app/router.ts';
import { profile } from '../state/profile.ts';
import { startLocalBattle } from './battleSession.ts';

type Opp = 'wild' | 'trainer' | 'elite' | 'human';

export function PlaySetup() {
  const loadouts = profile.value.loadouts;
  const [format, setFormat] = useState<FormatId>('first_blood');
  const [opp, setOpp] = useState<Opp>('wild');
  const [mine, setMine] = useState(loadouts[0]?.id ?? '');
  const [theirs, setTheirs] = useState(loadouts[1]?.id ?? loadouts[0]?.id ?? '');
  const [side, setSide] = useState<'white' | 'black'>('white');
  const [timed, setTimed] = useState(false);
  const start = () => {
    const a = loadouts.find((l) => l.id === mine);
    const b = loadouts.find((l) => l.id === theirs);
    if (!a || !b) return;
    startLocalBattle({ format, opponent: opp, mine: a, theirs: b, side, timed });
    go('battle');
  };
  return (
    <main class="setup">
      <h2>Local battle</h2>
      <label>
        Format
        <select
          value={format}
          onChange={(e) => setFormat((e.target as HTMLSelectElement).value as FormatId)}
        >
          {Object.values(FORMATS).map((f) => (
            <option value={f.id} key={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Opponent
        <select value={opp} onChange={(e) => setOpp((e.target as HTMLSelectElement).value as Opp)}>
          <option value="wild">Wild NPC (depth 2)</option>
          <option value="trainer">Trainer NPC (depth 3)</option>
          <option value="elite">Elite NPC (depth 4)</option>
          <option value="human">Hot-seat (two players)</option>
        </select>
      </label>
      <label>
        Your loadout
        <select value={mine} onChange={(e) => setMine((e.target as HTMLSelectElement).value)}>
          {loadouts.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name} (lvl {l.level})
            </option>
          ))}
        </select>
      </label>
      <label>
        Opponent loadout
        <select value={theirs} onChange={(e) => setTheirs((e.target as HTMLSelectElement).value)}>
          {loadouts.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name} (lvl {l.level})
            </option>
          ))}
        </select>
      </label>
      <label>
        Play as
        <select
          value={side}
          onChange={(e) => setSide((e.target as HTMLSelectElement).value as 'white' | 'black')}
        >
          <option value="white">White</option>
          <option value="black">Black</option>
        </select>
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={timed}
          onChange={(e) => setTimed((e.target as HTMLInputElement).checked)}
        />{' '}
        Use the format's clock
      </label>
      <div class="row">
        <button onClick={() => go('title')}>Back</button>
        <button class="primary" onClick={start}>
          Start
        </button>
      </div>
    </main>
  );
}
