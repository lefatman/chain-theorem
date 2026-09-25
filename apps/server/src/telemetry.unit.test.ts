/** Telemetry sinks (M5 5.5). */
import { describe, expect, it } from 'vitest';
import { AnalyticsSink, MemorySink } from './telemetry.ts';

describe('telemetry sinks (5.5)', () => {
  it('counts with dimensions and writes one Analytics Engine point per counter on flush', () => {
    const m = new MemorySink();
    m.count('ws_in', 2, { room: 'zone', type: 'step' });
    m.count('ws_in', 1, { type: 'step', room: 'zone' });
    expect(m.get('ws_in', { room: 'zone', type: 'step' })).toBe(3);
    const points: unknown[] = [];
    const a = new AnalyticsSink({ writeDataPoint: (p) => points.push(p) });
    a.count('battles', 1, { format: 'first_blood' });
    a.count('battles', 1, { format: 'first_blood' });
    a.flush();
    a.flush();
    expect(points).toEqual([
      { indexes: ['battles'], blobs: ['battles', 'format=first_blood'], doubles: [2] },
    ]);
  });
});
