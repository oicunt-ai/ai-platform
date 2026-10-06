import type { TokenUsage } from '@oicunt-ai/model-types';
import type { ToolCall } from '@oicunt-ai/tool-types';
import type {
  AgentId,
  AgentRunId,
  AgentRunStatus,
  AgentStepId,
  AgentStepStatus,
  AgentStepType,
  TerminationReason,
} from '../../domain/types.js';
import type {
  AgentConfirmationChallenge,
  AgentInputChallenge,
  ExecutionBudget,
  Observation,
} from '../../domain/value-objects.js';

export interface AgentRunSummaryDto {
  readonly runId: AgentRunId;
  readonly agentId: AgentId;
  readonly version: string;
  readonly tenantId: string;
  readonly status: AgentRunStatus;
  readonly currentStepNumber: number;
  readonly finalOutput?: string | undefined;
  readonly terminationReason?: TerminationReason | undefined;
  readonly cumulativeUsage: TokenUsage;
  readonly durationMs: number;
  readonly startedAt: string;
  readonly completedAt?: string | undefined;
}

export interface AgentStepDto {
  readonly stepId: AgentStepId;
  readonly runId: AgentRunId;
  readonly stepNumber: number;
  readonly type: AgentStepType;
  readonly status: AgentStepStatus;
  readonly decisionSummary?: string | undefined;
  readonly structuredDecision?: Record<string, unknown> | undefined;
  readonly action?: ToolCall | undefined;
  readonly observation?: Observation | undefined;
  readonly stepUsage?: TokenUsage | undefined;
  readonly durationMs: number;
  readonly startedAt: string;
  readonly completedAt?: string | undefined;
}

export interface AgentRunDetailDto extends AgentRunSummaryDto {
  readonly actorId: string;
  readonly correlationId: string;
  readonly conversationId?: string | undefined;
  readonly budget: ExecutionBudget;
  readonly steps: readonly AgentStepDto[];
  readonly pendingChallenge?:
    | { readonly type: 'confirmation'; readonly challenge: AgentConfirmationChallenge }
    | { readonly type: 'user_input'; readonly challenge: AgentInputChallenge }
    | undefined;
}

export type AgentStreamEventType =
  | 'run_started'
  | 'step_started'
  | 'thought'
  | 'action_requested'
  | 'waiting_for_confirmation'
  | 'waiting_for_input'
  | 'run_resumed'
  | 'observation'
  | 'step_completed'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled';

export interface AgentStreamEvent {
  readonly event: AgentStreamEventType;
  readonly data: Record<string, unknown>;
}
