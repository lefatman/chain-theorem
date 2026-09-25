/**
 * The infrastructure cost model of spec 14.1 (R-COST-001) and the guardrail of 14.2 (R-COST-002):
 * turns measured usage into dollars per player-hour and per heavy subscriber-month. Rates are the
 * published ones the spec uses; re-measure against real invoices once telemetry exists (R-COST-003).
 */
export const RATES = {
  /** Durable Objects: $ per million requests; incoming WebSocket messages count 20:1. */
  doRequestPerM: 0.15,
  wsIncomingPerRequest: 20,
  /** Durable Objects: $ per million GB-seconds of duration (128 MB per object). */
  gbSecondPerM: 12.5,
  /** Durable Object SQLite: $ per million rows written. */
  rowsWrittenPerM: 1.0,
  /** Workers: $ per million requests beyond the included 10 million. */
  workerRequestPerM: 0.3,
} as const;

/** 14.1: a heavy subscriber plays 60 hours a month. */
export const HEAVY_HOURS_PER_MONTH = 60;
/** 14.2 guardrail: alert above $0.10 of infrastructure per subscriber per month. */
export const GUARDRAIL_PER_SUBSCRIBER = 0.1;

export interface Usage {
  /** Player-hours the usage covers (sum over players of time online). */
  playerHours: number;
  /** Incoming WebSocket messages to Durable Objects (billed 20:1). */
  wsIncoming: number;
  /** Other Durable Object requests (fetches, alarms). */
  doRequests: number;
  /** Durable Object duration in GB-seconds (wall time while not hibernated × 0.128 GB). */
  gbSeconds: number;
  /** Durable Object SQLite rows written. */
  rowsWritten: number;
  /** Worker requests (REST, upgrades, assets that run the Worker). */
  workerRequests: number;
}

export interface CostReport {
  total: number;
  perPlayerHour: number;
  perSubscriberMonth: number;
  withinGuardrail: boolean;
  breakdown: Record<'requests' | 'duration' | 'rows' | 'workers', number>;
}

/** Worst-case (no free allowance) variable cost of `u`. */
export function cost(u: Usage): CostReport {
  const requests =
    ((u.wsIncoming / RATES.wsIncomingPerRequest + u.doRequests) / 1e6) * RATES.doRequestPerM;
  const duration = (u.gbSeconds / 1e6) * RATES.gbSecondPerM;
  const rows = (u.rowsWritten / 1e6) * RATES.rowsWrittenPerM;
  const workers = (u.workerRequests / 1e6) * RATES.workerRequestPerM;
  const total = requests + duration + rows + workers;
  const perPlayerHour = u.playerHours > 0 ? total / u.playerHours : 0;
  const perSubscriberMonth = perPlayerHour * HEAVY_HOURS_PER_MONTH;
  return {
    total,
    perPlayerHour,
    perSubscriberMonth,
    withinGuardrail: perSubscriberMonth <= GUARDRAIL_PER_SUBSCRIBER,
    breakdown: { requests, duration, rows, workers },
  };
}
