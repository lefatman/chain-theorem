/** The cost model (R-COST-001, R-COST-002) and telemetry sinks (5.5). */
import { describe, expect, it } from 'vitest';
import { cost, GUARDRAIL_PER_SUBSCRIBER } from './cost.ts';
import { AnalyticsSink, MemorySink } from './telemetry.ts';

describe('cost model (R-COST-001, R-COST-002)', () => {
  it('R-COST-001 reproduces the heavy-player scenario of spec 14.1 (about $0.009 a month)', () => {
    // 14.1 per subscriber-month: 216,000 zone messages, ~2,050 battle requests, ~7.5 GB-s battle
    // plus 54 GB-s zone duration, ~5,000 rows, ~5,000 Worker requests; 60 hours.
    const r = cost({
      playerHours: 60,
      wsIncoming: 216_000,
      doRequests: 2_050,
      gbSeconds: 54 + 7.5,
      rowsWritten: 5_000,
      workerRequests: 5_000,
    });
    expect(r.perSubscriberMonth).toBeGreaterThan(0.005);
    expect(r.perSubscriberMonth).toBeLessThan(0.015);
    expect(r.withinGuardrail).toBe(true);
    expect(GUARDRAIL_PER_SUBSCRIBER).toBe(0.1);
  });

  it('R-COST-002 flags usage beyond $0.10 per subscriber-month', () => {
    const r = cost({
      playerHours: 1,
      wsIncoming: 1_000_000,
      doRequests: 0,
      gbSeconds: 0,
      rowsWritten: 0,
      workerRequests: 0,
    });
    expect(r.withinGuardrail).toBe(false);
  });
});

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
