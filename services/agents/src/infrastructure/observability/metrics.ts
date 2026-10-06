import type { AgentRunStatus } from '../../domain/types.js';

export interface AgentMetricsCollector {
  recordRun(params: {
    readonly agentId: string;
    readonly version: string;
    readonly tenantId: string;
    readonly status: AgentRunStatus;
    readonly durationMs: number;
    readonly totalSteps: number;
  }): void;

  recordStep(params: {
    readonly agentId: string;
    readonly runId: string;
    readonly stepType: string;
    readonly durationMs: number;
  }): void;

  recordError(params: { readonly agentId?: string | undefined; readonly code: string }): void;
}

export class InMemoryAgentMetricsCollector implements AgentMetricsCollector {
  private readonly runs: Array<{
    readonly agentId: string;
    readonly version: string;
    readonly tenantId: string;
    readonly status: AgentRunStatus;
    readonly durationMs: number;
    readonly totalSteps: number;
  }> = [];

  private readonly steps: Array<{
    readonly agentId: string;
    readonly runId: string;
    readonly stepType: string;
    readonly durationMs: number;
  }> = [];

  private readonly errors: Array<{
    readonly agentId?: string | undefined;
    readonly code: string;
  }> = [];

  public recordRun(params: {
    readonly agentId: string;
    readonly version: string;
    readonly tenantId: string;
    readonly status: AgentRunStatus;
    readonly durationMs: number;
    readonly totalSteps: number;
  }): void {
    this.runs.push(params);
  }

  public recordStep(params: {
    readonly agentId: string;
    readonly runId: string;
    readonly stepType: string;
    readonly durationMs: number;
  }): void {
    this.steps.push(params);
  }

  public recordError(params: {
    readonly agentId?: string | undefined;
    readonly code: string;
  }): void {
    this.errors.push(params);
  }

  public getRuns() {
    return Object.freeze([...this.runs]);
  }

  public getSteps() {
    return Object.freeze([...this.steps]);
  }

  public getErrors() {
    return Object.freeze([...this.errors]);
  }

  public clear(): void {
    this.runs.length = 0;
    this.steps.length = 0;
    this.errors.length = 0;
  }
}
