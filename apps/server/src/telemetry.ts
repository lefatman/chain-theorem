/**
 * Telemetry (M5 5.5, R-COST-002): counters for balance and cost tracking. Production writes to Workers
 * Analytics Engine (one data point per flush, cheap); local development and tests use an in-memory
 * sink that can be read back. Rooms count what the cost model needs: incoming socket messages,
 * requests, alarms, rows written, active time.
 */
export interface TelemetrySink {
  count(name: string, n?: number, dims?: Record<string, string>): void;
  /** Write buffered counters (Analytics Engine) or no-op. */
  flush(): void;
}

/** Key for a counter with dimensions: `name|k=v|k=v` (dimensions sorted). */
export function counterKey(name: string, dims: Record<string, string> = {}): string {
  const parts = Object.keys(dims)
    .sort()
    .map((k) => `${k}=${dims[k]}`);
  return [name, ...parts].join('|');
}

export class MemorySink implements TelemetrySink {
  readonly counters = new Map<string, number>();
  count(name: string, n = 1, dims?: Record<string, string>): void {
    const k = counterKey(name, dims);
    this.counters.set(k, (this.counters.get(k) ?? 0) + n);
  }
  flush(): void {}
  get(name: string, dims?: Record<string, string>): number {
    return this.counters.get(counterKey(name, dims)) ?? 0;
  }
  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.counters].sort(([a], [b]) => (a < b ? -1 : 1)));
  }
}

/** Minimal shape of the Analytics Engine binding. */
export interface AnalyticsDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

/** Buffers counters and writes one data point per counter key on flush. */
export class AnalyticsSink implements TelemetrySink {
  private readonly buffer = new MemorySink();
  private readonly dataset: AnalyticsDataset;
  constructor(dataset: AnalyticsDataset) {
    this.dataset = dataset;
  }
  count(name: string, n = 1, dims?: Record<string, string>): void {
    this.buffer.count(name, n, dims);
  }
  flush(): void {
    for (const [key, n] of this.buffer.counters) {
      const [name = key, ...dims] = key.split('|');
      this.dataset.writeDataPoint({ indexes: [name], blobs: [name, ...dims], doubles: [n] });
    }
    this.buffer.counters.clear();
  }
}

export function telemetrySink(dataset: AnalyticsDataset | undefined): TelemetrySink {
  return dataset ? new AnalyticsSink(dataset) : new MemorySink();
}
