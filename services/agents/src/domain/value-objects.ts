import type { AgentRunId } from './types.js';

export type ToolCallMode = 'auto' | 'required' | 'none';

export type ConfirmationBehavior = 'pause_and_notify' | 'reject_unconfirmed';

/**
 * Execution bounds governing an agent run.
 */
export interface ExecutionBudget {
  /** Maximum allowable loop iterations (default: 15, hard maximum: 50). */
  readonly maxSteps: number;

  /** Absolute monotonic epoch millisecond timestamp marking run deadline. */
  readonly deadlineMs: number;

  /** Maximum permitted LLM completions across the run (default: 20). */
  readonly maxModelCalls: number;

  /** Maximum permitted tool invocations across the run (default: 30). */
  readonly maxToolCalls: number;

  /** Cumulative token limit (prompt + completion + reasoning) across all steps. */
  readonly maxTokens?: number | undefined;

  /** Maximum consecutive step-level failures before halting (default: 3). */
  readonly maxConsecutiveErrors: number;
}

/**
 * Privacy and redaction settings for reasoning and logs.
 */
export interface AgentPrivacyPolicy {
  /**
   * If true, policy-approved, sanitized normalized thinking events may be emitted.
   * Under NO circumstances does this permit exposing raw chain-of-thought.
   */
  readonly emitNormalizedThinkingEvents: boolean;

  /**
   * Guarantees thinking blocks are scrubbed before structured JSON logs or traces are emitted.
   */
  readonly redactThinkingInLogs: boolean;
}

/**
 * Behavioral policies configured for an agent definition.
 */
export interface AgentPolicy {
  readonly toolCallMode: ToolCallMode;
  readonly confirmationBehavior: ConfirmationBehavior;
  readonly privacyPolicy: AgentPrivacyPolicy;
  readonly maxConsecutiveErrors: number;
}

/**
 * Normalized outcome of an executed capability incorporated into context.
 */
export interface Observation {
  readonly callId: string;
  readonly toolId: string;
  readonly isSuccess: boolean;
  readonly output?: unknown;
  readonly error?:
    | {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
      }
    | undefined;
  readonly executionDurationMs: number;
  readonly recordedAt: string;
}

/**
 * Challenge structure when an agent is suspended awaiting external user input.
 */
export interface AgentInputChallenge {
  readonly inputId: string;
  readonly runId: AgentRunId;
  readonly stepNumber: number;
  readonly prompt: string;
  readonly schema?: Record<string, unknown> | undefined;
  readonly options?: readonly string[] | undefined;
  readonly defaultValue?: unknown;
  readonly expiresAt: string;
}

/**
 * Challenge details when a tool suspended execution awaiting cryptographic confirmation.
 */
export interface AgentConfirmationChallenge {
  readonly confirmationId: string;
  readonly challengeToken: string;
  readonly toolId: string;
  readonly callId: string;
  readonly arguments: Record<string, unknown>;
  readonly expiresAt: string;
}

export const DEFAULT_EXECUTION_BUDGET: Omit<ExecutionBudget, 'deadlineMs'> = {
  maxSteps: 15,
  maxModelCalls: 20,
  maxToolCalls: 30,
  maxConsecutiveErrors: 3,
};

export const HARD_LIMITS = {
  MAX_STEPS: 50,
  MAX_MODEL_CALLS: 100,
  MAX_TOOL_CALLS: 100,
  DEFAULT_TIMEOUT_MS: 120_000,
  MAX_TIMEOUT_MS: 600_000,
  DEFAULT_CHALLENGE_TTL_MS: 15 * 60 * 1000, // 15 minutes
} as const;

export function resolveExecutionBudget(
  overrides?: Partial<ExecutionBudget> | undefined,
  defaultBudget?: Partial<ExecutionBudget> | undefined,
  requestedTimeoutMs?: number | undefined,
): ExecutionBudget {
  const timeoutMs = Math.min(
    Math.max(1000, requestedTimeoutMs ?? HARD_LIMITS.DEFAULT_TIMEOUT_MS),
    HARD_LIMITS.MAX_TIMEOUT_MS,
  );
  const deadlineMs = overrides?.deadlineMs ?? Date.now() + timeoutMs;

  const maxSteps = Math.min(
    Math.max(
      1,
      overrides?.maxSteps ?? defaultBudget?.maxSteps ?? DEFAULT_EXECUTION_BUDGET.maxSteps,
    ),
    HARD_LIMITS.MAX_STEPS,
  );

  const maxModelCalls = Math.min(
    Math.max(
      1,
      overrides?.maxModelCalls ??
        defaultBudget?.maxModelCalls ??
        DEFAULT_EXECUTION_BUDGET.maxModelCalls,
    ),
    HARD_LIMITS.MAX_MODEL_CALLS,
  );

  const maxToolCalls = Math.min(
    Math.max(
      0,
      overrides?.maxToolCalls ??
        defaultBudget?.maxToolCalls ??
        DEFAULT_EXECUTION_BUDGET.maxToolCalls,
    ),
    HARD_LIMITS.MAX_TOOL_CALLS,
  );

  const maxConsecutiveErrors = Math.max(
    1,
    overrides?.maxConsecutiveErrors ??
      defaultBudget?.maxConsecutiveErrors ??
      DEFAULT_EXECUTION_BUDGET.maxConsecutiveErrors,
  );

  return {
    maxSteps,
    deadlineMs,
    maxModelCalls,
    maxToolCalls,
    maxTokens: overrides?.maxTokens ?? defaultBudget?.maxTokens,
    maxConsecutiveErrors,
  };
}
