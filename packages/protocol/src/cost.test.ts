/** The cost model (R-COST-001, R-COST-002) and telemetry sinks (5.5). */
import { describe, expect, it } from 'vitest';
import { cost, GUARDRAIL_PER_SUBSCRIBER } from './cost.ts';

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
