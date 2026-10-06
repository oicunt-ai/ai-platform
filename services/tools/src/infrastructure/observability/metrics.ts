export interface MetricsCollector {
  recordInvocation(params: {
    readonly toolId: string;
    readonly version: string;
    readonly tenantId: string;
    readonly status: 'success' | 'failure';
    readonly durationMs: number;
  }): void;

  recordError(params: { readonly toolId: string; readonly code: string }): void;

  recordActiveConcurrency(toolId: string, delta: number): void;
}

export class InMemoryMetricsCollector implements MetricsCollector {
  private readonly invocations: Array<{
    readonly toolId: string;
    readonly version: string;
    readonly tenantId: string;
    readonly status: 'success' | 'failure';
    readonly durationMs: number;
  }> = [];

  private readonly errors: Array<{
    readonly toolId: string;
    readonly code: string;
  }> = [];

  private readonly activeConcurrency = new Map<string, number>();

  public recordInvocation(params: {
    readonly toolId: string;
    readonly version: string;
    readonly tenantId: string;
    readonly status: 'success' | 'failure';
    readonly durationMs: number;
  }): void {
    this.invocations.push(params);
  }

  public recordError(params: { readonly toolId: string; readonly code: string }): void {
    this.errors.push(params);
  }

  public recordActiveConcurrency(toolId: string, delta: number): void {
    const current = this.activeConcurrency.get(toolId) ?? 0;
    this.activeConcurrency.set(toolId, Math.max(0, current + delta));
  }

  public getInvocations() {
    return Object.freeze([...this.invocations]);
  }

  public getErrors() {
    return Object.freeze([...this.errors]);
  }

  public clear(): void {
    this.invocations.length = 0;
    this.errors.length = 0;
    this.activeConcurrency.clear();
  }
}
