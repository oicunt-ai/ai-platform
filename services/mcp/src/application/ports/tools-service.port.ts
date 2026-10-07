import type { CanonicalToolDefinition } from '../../domain/types.js';

export interface ToolsServicePort {
  registerTool(tool: CanonicalToolDefinition, tenantId?: string): Promise<void>;
}
