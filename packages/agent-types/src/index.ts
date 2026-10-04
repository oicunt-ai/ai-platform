import type { CanonicalModelId, TokenUsage } from '@oicunt-ai/model-types';
import type { ChatMessage } from '@oicunt-ai/ai-types';
import type { ToolCall, ToolResult } from '@oicunt-ai/tool-types';

/**
 * Unique identifier for a configured agent definition.
 */
export type AgentId = string;

/**
 * Unique identifier for a specific agent execution session/run.
 */
export type AgentRunId = string;

/**
 * Status of an agent run lifecycle.
 */
export type AgentExecutionStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_input'
  | 'waiting_for_tool'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Category of intermediate step in the ReAct / agent loop.
 */
export type AgentStepType = 'thought' | 'action' | 'observation' | 'response';

/**
 * Declarative configuration for an AI Agent.
 */
export interface AgentConfig {
  readonly id: AgentId;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly model: CanonicalModelId;
  readonly allowedTools: readonly string[];
  readonly maxSteps: number;
  readonly temperature?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Single recorded step in an agent run trace.
 */
export interface AgentStep {
  readonly stepId: string;
  readonly stepNumber: number;
  readonly type: AgentStepType;
  readonly content: string;
  readonly toolCall?: ToolCall;
  readonly toolResult?: ToolResult;
  readonly timestamp: string;
}

/**
 * Runtime execution context passed to an agent coordinator.
 */
export interface AgentRunContext {
  readonly runId: AgentRunId;
  readonly agentId: AgentId;
  readonly sessionId?: string;
  readonly correlationId: string;
  readonly initialMessages: readonly ChatMessage[];
  readonly metadata?: Record<string, unknown>;
  readonly timeoutMs?: number;
}

/**
 * Terminal result returned upon agent run completion.
 */
export interface AgentRunResult {
  readonly runId: AgentRunId;
  readonly agentId: AgentId;
  readonly status: AgentExecutionStatus;
  readonly steps: readonly AgentStep[];
  readonly finalResponse?: string;
  readonly totalUsage: TokenUsage;
  readonly durationMs: number;
  readonly error?: string;
}

/**
 * Error raised during an agent execution loop.
 */
export class AgentExecutionError extends Error {
  public readonly agentId: AgentId;
  public readonly runId?: AgentRunId | undefined;

  constructor(message: string, agentId: AgentId, runId?: AgentRunId) {
    super(message);
    this.name = 'AgentExecutionError';
    this.agentId = agentId;
    this.runId = runId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
