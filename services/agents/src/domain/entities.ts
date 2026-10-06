import type { CanonicalModelId, ReasoningEffortLevel, TokenUsage } from '@oicunt-ai/model-types';
import type { ToolCall } from '@oicunt-ai/tool-types';
import type {
  AgentCategory,
  AgentId,
  AgentRunId,
  AgentRunStatus,
  AgentStatus,
  AgentStepId,
  AgentStepStatus,
  AgentStepType,
  TerminationReason,
} from './types.js';
import type {
  AgentConfirmationChallenge,
  AgentInputChallenge,
  AgentPolicy,
  ExecutionBudget,
  Observation,
} from './value-objects.js';

export interface Agent {
  readonly agentId: AgentId;
  readonly name: string;
  readonly description: string;
  readonly category: AgentCategory;
  readonly status: AgentStatus;
  readonly latestVersion: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentVersion {
  readonly agentId: AgentId;
  readonly version: string; // SemVer: '1.0.0'
  readonly systemInstructions: string;
  readonly defaultModel: CanonicalModelId;
  readonly defaultEffort: ReasoningEffortLevel;
  readonly allowedTools: readonly string[];
  readonly defaultBudget: ExecutionBudget;
  readonly policy: AgentPolicy;
  readonly isFrozen: boolean;
  readonly publishedAt: string;
}

export interface AgentRun {
  readonly runId: AgentRunId;
  readonly agentId: AgentId;
  readonly agentVersion: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly conversationId?: string | undefined;
  readonly status: AgentRunStatus;
  readonly budget: ExecutionBudget;
  readonly cumulativeUsage: TokenUsage;
  readonly finalOutput?: string | undefined;
  readonly terminationReason?: TerminationReason | undefined;
  readonly currentStepNumber: number;
  readonly workerLeaseId?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly startedAt: string;
  readonly completedAt?: string | undefined;
}

export interface AgentStep {
  readonly stepId: AgentStepId;
  readonly runId: AgentRunId;
  readonly stepNumber: number;
  readonly type: AgentStepType;
  readonly status: AgentStepStatus;

  /**
   * High-level summary of the decision made in this step.
   * Under NO circumstances is raw model chain-of-thought stored here.
   */
  readonly decisionSummary?: string | undefined;

  /**
   * Structured planning and action intent metadata.
   */
  readonly structuredDecision?: Record<string, unknown> | undefined;

  /** Invocation request if the step produced a tool call. */
  readonly action?: ToolCall | undefined;

  /** Normalized outcome if the step incorporated an observation. */
  readonly observation?: Observation | undefined;

  /** Token accounting recorded for this step. */
  readonly stepUsage?: TokenUsage | undefined;

  /** Step execution duration in milliseconds. */
  readonly durationMs: number;

  readonly startedAt: string;
  readonly completedAt?: string | undefined;
}

export interface AgentCheckpoint {
  readonly checkpointId: string;
  readonly runId: AgentRunId;
  readonly stepNumber: number;
  readonly statePayload: {
    readonly goalInput: string;
    readonly activePlan?: Record<string, unknown> | undefined;
    readonly scratchpad: readonly Observation[];
    readonly decisionSummaries: readonly string[];
    readonly cumulativeUsage: TokenUsage;
  };
  readonly pendingChallenge?:
    | { readonly type: 'confirmation'; readonly challenge: AgentConfirmationChallenge }
    | { readonly type: 'user_input'; readonly challenge: AgentInputChallenge }
    | undefined;
  readonly createdAt: string;
}
