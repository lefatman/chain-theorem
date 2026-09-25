/**
 * Battle clocks (9.2, R-FMT-003): Fischer increment; the controller owns the numbers and the UI
 * interpolates between samples. The running clock shows a marker and low time a warning icon, so
 * neither depends on colour (R-ART-002).
 */
import { useEffect, useState } from 'preact/hooks';
import type { Side } from '@chain-theorem/rules';
import type { BattleController } from '../battle/controller.ts';

export const LOW_TIME_MS = 20_000;

export function formatClock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(t / 60);
  if (m >= 60)
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  return `${m}:${String(t % 60).padStart(2, '0')}`;
}

/** Clock samples use performance.now() locally and epoch ms from a server; pick the matching base. */
export function nowFor(sample: number): number {
  return sample > 1e12 ? Date.now() : performance.now();
}

export function Clocks({ controller, side }: { controller: BattleController; side: Side }) {
  const c = controller.snapshot.value.clocks;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!c || c.running !== side) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [c?.running, c?.at, side]);
  if (!c) return <span class="clock muted">Untimed</span>;
  const running = c.running === side;
  const left = c[side] - (running ? nowFor(c.at) - c.at : 0);
  const low = left < LOW_TIME_MS;
  return (
    <span
      class={`clock ${running ? 'running' : ''} ${low ? 'low' : ''}`}
      role="timer"
      aria-label={`${side} clock ${formatClock(left)}${running ? ', running' : ''}${low ? ', low time' : ''}`}
    >
      <span class="clock-mark" aria-hidden="true">
        {running ? '▸' : ' '}
      </span>
      {low && (
        <span aria-hidden="true" class="clock-warn">
          {'⚠︎'}
        </span>
      )}
      {formatClock(left)}
    </span>
  );
}
