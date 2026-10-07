import type { ToolId } from '../types.js';

export function sanitizeIdentifier(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
}

/**
 * Builds the canonical deterministic OICUNT ToolId for an MCP-backed tool:
 * Format: `oicunt.tool.mcp.<server_id>.<tool_name>`
 */
export function buildCanonicalToolId(serverId: string, originalToolName: string): ToolId {
  const sanitizedServer = sanitizeIdentifier(serverId);
  const sanitizedTool = sanitizeIdentifier(originalToolName);
  return `oicunt.tool.mcp.${sanitizedServer}.${sanitizedTool}` as ToolId;
}

/**
 * Parses a canonical OICUNT ToolId to extract the underlying MCP serverId and toolName.
 * Returns null if the toolId is not an MCP-backed tool identifier.
 */
export function parseCanonicalToolId(
  toolId: string,
): { serverId: string; toolName: string } | null {
  const prefix = 'oicunt.tool.mcp.';
  if (!toolId.startsWith(prefix)) {
    return null;
  }

  const remainder = toolId.slice(prefix.length);
  const dotIndex = remainder.indexOf('.');
  if (dotIndex === -1) {
    return null;
  }

  const serverId = remainder.slice(0, dotIndex);
  const toolName = remainder.slice(dotIndex + 1);

  if (!serverId || !toolName) {
    return null;
  }

  return { serverId, toolName };
}
