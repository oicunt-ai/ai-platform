import { createHash } from 'node:crypto';
import type { McpTool } from '@oicunt-ai/mcp-types';
import type { ToolParametersSchema } from '@oicunt-ai/tool-types';
import type { CanonicalToolDefinition } from '../types.js';
import { McpSecurityError } from '../errors.js';
import { buildCanonicalToolId } from './identity.js';

export const MAX_SCHEMA_BYTES = 64 * 1024; // 64 KB limit
export const MAX_PROPERTIES_COUNT = 100;

export function computeSchemaHash(schema: unknown): string {
  const json = JSON.stringify(schema ?? {});
  return createHash('sha256').update(json).digest('hex');
}

export function validateMcpToolSchema(tool: McpTool): void {
  const serialized = JSON.stringify(tool.inputSchema ?? {});
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_SCHEMA_BYTES) {
    throw new McpSecurityError(
      `MCP Tool '${tool.name}' inputSchema exceeds maximum allowed size of 64 KB`,
    );
  }

  // Check prototype pollution attempts in schema keys
  if (
    serialized.includes('__proto__') ||
    serialized.includes('constructor') ||
    serialized.includes('prototype')
  ) {
    throw new McpSecurityError(`MCP Tool '${tool.name}' schema contains forbidden prototype keys`);
  }

  const properties = tool.inputSchema?.properties;
  if (properties && typeof properties === 'object') {
    const keys = Object.keys(properties);
    if (keys.length > MAX_PROPERTIES_COUNT) {
      throw new McpSecurityError(
        `MCP Tool '${tool.name}' schema exceeds maximum property count of ${MAX_PROPERTIES_COUNT}`,
      );
    }
  }
}

/**
 * Normalizes an external McpTool into an authoritative OICUNT ToolDefinition.
 */
export function normalizeMcpToolToOicunt(
  serverId: string,
  mcpTool: McpTool,
  options: { readonly isReadOnly?: boolean; readonly requiresConfirmation?: boolean } = {},
): CanonicalToolDefinition {
  validateMcpToolSchema(mcpTool);

  const toolId = buildCanonicalToolId(serverId, mcpTool.name);
  const isReadOnly = options.isReadOnly ?? false;
  const hasSideEffects = !isReadOnly;
  const requiresConfirmation = options.requiresConfirmation ?? false;

  const parameters: ToolParametersSchema = {
    type: 'object',
    properties: mcpTool.inputSchema?.properties ?? {},
    required: mcpTool.inputSchema?.required ?? [],
    additionalProperties: mcpTool.inputSchema?.additionalProperties ?? false,
  };

  return {
    toolId,
    displayName: mcpTool.name,
    description:
      mcpTool.description ?? `MCP-backed tool '${mcpTool.name}' from server '${serverId}'`,
    version: '1.0.0',
    category: 'integration',
    source: 'mcp',
    capabilities: {
      isReadOnly,
      hasSideEffects,
      requiresConfirmation,
      networkEgress: true,
      accessesSensitiveData: false,
    },
    parameters,
    outputSchema: {
      type: 'object',
      description: 'Normalized MCP result output envelope',
    },
    timeoutPolicy: {
      defaultTimeoutMs: 30000,
      maxTimeoutMs: 120000,
    },
    status: 'active',
    tags: ['mcp', serverId],
  };
}
