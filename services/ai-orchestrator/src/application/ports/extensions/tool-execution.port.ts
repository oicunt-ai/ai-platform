import type { ToolCallPart, ToolResultPart } from '@oicunt-ai/ai-types';

/**
 * Execution context provided when invoking a sandboxed tool.
 */
export interface ToolExecutionContext {
  readonly correlationId: string;
  readonly conversationId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * Future extension port for isolated tool sandbox execution (services/tools).
 */
export interface ToolExecutionPort {
  /**
   * Executes a requested tool call in a secure sandbox and returns the execution result.
   */
  executeTool(toolCall: ToolCallPart, context: ToolExecutionContext): Promise<ToolResultPart>;
}
