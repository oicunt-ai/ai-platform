export interface MetricCounterSnapshot {
  readonly labels: Record<string, string>;
  readonly value: number;
}

export interface MetricHistogramSnapshot {
  readonly labels: Record<string, string>;
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
}

export interface EmbeddingsMetricsSnapshot {
  readonly requestsTotal: readonly MetricCounterSnapshot[];
  readonly inputsTotal: readonly MetricCounterSnapshot[];
  readonly tokensTotal: readonly MetricCounterSnapshot[];
  readonly durationMs: readonly MetricHistogramSnapshot[];
  readonly batchSize: readonly MetricHistogramSnapshot[];
  readonly errorsTotal: readonly MetricCounterSnapshot[];
}

function labelsKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
}

export class EmbeddingsMetrics {
  private readonly requests = new Map<string, { labels: Record<string, string>; value: number }>();
  private readonly inputs = new Map<string, { labels: Record<string, string>; value: number }>();
  private readonly tokens = new Map<string, { labels: Record<string, string>; value: number }>();
  private readonly errors = new Map<string, { labels: Record<string, string>; value: number }>();
  private readonly durations = new Map<
    string,
    { labels: Record<string, string>; count: number; sum: number; min: number; max: number }
  >();
  private readonly batchSizes = new Map<
    string,
    { labels: Record<string, string>; count: number; sum: number; min: number; max: number }
  >();

  public recordRequest(model: string, tenantId: string, status: string): void {
    const labels = { model, tenant_id: tenantId, status };
    const key = labelsKey(labels);
    const existing = this.requests.get(key) ?? { labels, value: 0 };
    this.requests.set(key, { labels, value: existing.value + 1 });
  }

  public recordInputs(model: string, tenantId: string, count: number): void {
    const labels = { model, tenant_id: tenantId };
    const key = labelsKey(labels);
    const existing = this.inputs.get(key) ?? { labels, value: 0 };
    this.inputs.set(key, { labels, value: existing.value + count });
  }

  public recordTokens(model: string, tenantId: string, tokens: number): void {
    const labels = { model, tenant_id: tenantId };
    const key = labelsKey(labels);
    const existing = this.tokens.get(key) ?? { labels, value: 0 };
    this.tokens.set(key, { labels, value: existing.value + tokens });
  }

  public recordDuration(model: string, status: string, durationMs: number): void {
    const labels = { model, status };
    const key = labelsKey(labels);
    const existing = this.durations.get(key) ?? {
      labels,
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    };
    this.durations.set(key, {
      labels,
      count: existing.count + 1,
      sum: existing.sum + durationMs,
      min: Math.min(existing.min, durationMs),
      max: Math.max(existing.max, durationMs),
    });
  }

  public recordBatchSize(model: string, batchSize: number): void {
    const labels = { model };
    const key = labelsKey(labels);
    const existing = this.batchSizes.get(key) ?? {
      labels,
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    };
    this.batchSizes.set(key, {
      labels,
      count: existing.count + 1,
      sum: existing.sum + batchSize,
      min: Math.min(existing.min, batchSize),
      max: Math.max(existing.max, batchSize),
    });
  }

  public recordError(code: string, model: string): void {
    const labels = { code, model };
    const key = labelsKey(labels);
    const existing = this.errors.get(key) ?? { labels, value: 0 };
    this.errors.set(key, { labels, value: existing.value + 1 });
  }

  public getSnapshot(): EmbeddingsMetricsSnapshot {
    return {
      requestsTotal: Array.from(this.requests.values()),
      inputsTotal: Array.from(this.inputs.values()),
      tokensTotal: Array.from(this.tokens.values()),
      durationMs: Array.from(this.durations.values()),
      batchSize: Array.from(this.batchSizes.values()),
      errorsTotal: Array.from(this.errors.values()),
    };
  }

  public reset(): void {
    this.requests.clear();
    this.inputs.clear();
    this.tokens.clear();
    this.durations.clear();
    this.batchSizes.clear();
    this.errors.clear();
  }
}
