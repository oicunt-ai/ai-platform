import type { AgentConfirmationChallenge } from '../../domain/value-objects.js';

export interface AgentToolExecutionRequest {
  readonly toolId: string;
  readonly callId: string;
  readonly arguments: Record<string, unknown>;
  readonly confirmationToken?: string | null | undefined;
  readonly timeoutMs?: number | undefined;
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface AgentToolExecutionSuccess {
  readonly status: 'success';
  readonly output: unknown;
  readonly artifacts?: readonly unknown[] | undefined;
  readonly durationMs: number;
}

export interface AgentToolExecutionConfirmationRequired {
  readonly status: 'confirmation_required';
  readonly challenge: AgentConfirmationChallenge;
}

export interface AgentToolExecutionFailure {
  readonly status: 'failure';
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
  readonly durationMs: number;
}

export type AgentToolExecutionOutcome =
  AgentToolExecutionSuccess | AgentToolExecutionConfirmationRequired | AgentToolExecutionFailure;

export interface ToolsClientPort {
  executeTool(
    request: AgentToolExecutionRequest,
    signal?: AbortSignal | undefined,
  ): Promise<AgentToolExecutionOutcome>;
}
