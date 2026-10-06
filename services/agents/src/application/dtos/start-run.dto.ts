import type { AgentId, ExecutionMode } from '../../domain/types.js';
import type { ExecutionBudget } from '../../domain/value-objects.js';

export interface StartRunDto {
  readonly agentId: AgentId;
  readonly version?: string | undefined;
  readonly input: string;
  readonly conversationId?: string | undefined;
  readonly budget?:
    (Partial<ExecutionBudget> & { readonly timeoutMs?: number | undefined }) | undefined;
  readonly mode?: ExecutionMode | undefined;
  readonly stream?: boolean | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}
