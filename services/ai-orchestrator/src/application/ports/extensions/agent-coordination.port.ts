import type { ChatMessage } from '@oicunt-ai/ai-types';

export interface AgentRunRequest {
  readonly agentId: string;
  readonly planId?: string | undefined;
  readonly stepIndex: number;
  readonly messages: readonly ChatMessage[];
  readonly context: Record<string, unknown>;
}

export interface AgentRunResult {
  readonly runId: string;
  readonly status: 'in_progress' | 'completed' | 'failed' | 'requires_approval';
  readonly outputMessages: readonly ChatMessage[];
  readonly checkpointId?: string | undefined;
}

/**
 * Future extension port for multi-step agent orchestration (services/agents).
 */
export interface AgentCoordinationPort {
  /**
   * Dispatches an agent execution step.
   */
  coordinateAgentStep(request: AgentRunRequest): Promise<AgentRunResult>;
}
