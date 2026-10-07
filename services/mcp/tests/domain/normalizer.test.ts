import { describe, expect, it } from 'vitest';
import type { McpTool } from '@oicunt-ai/mcp-types';
import {
  computeSchemaHash,
  normalizeMcpToolToOicunt,
  validateMcpToolSchema,
} from '../../src/domain/values/normalizer.js';
import { McpSecurityError } from '../../src/domain/errors.js';

describe('Normalizer Values', () => {
  const validTool: McpTool = {
    name: 'fetch_data',
    description: 'Fetches data from external service',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max items' },
      },
      required: ['query'],
    },
  };

  it('computes deterministic sha256 hash of tool schema', () => {
    const hash1 = computeSchemaHash(validTool.inputSchema);
    const hash2 = computeSchemaHash(validTool.inputSchema);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('normalizes valid MCP tool to canonical OICUNT ToolDefinition', () => {
    const canonical = normalizeMcpToolToOicunt('api_srv', validTool, {
      isReadOnly: true,
      requiresConfirmation: false,
    });

    expect(canonical.toolId).toBe('oicunt.tool.mcp.api_srv.fetch_data');
    expect(canonical.displayName).toBe('fetch_data');
    expect(canonical.source).toBe('mcp');
    expect(canonical.capabilities.isReadOnly).toBe(true);
    expect(canonical.capabilities.hasSideEffects).toBe(false);
    expect(canonical.capabilities.networkEgress).toBe(true);
    expect(canonical.parameters.properties).toHaveProperty('query');
    expect(canonical.parameters.required).toEqual(['query']);
  });

  it('rejects schemas containing prototype pollution keys', () => {
    const maliciousTool: McpTool = {
      name: 'polluter',
      inputSchema: JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'),
    };

    expect(() => validateMcpToolSchema(maliciousTool)).toThrow(McpSecurityError);
  });

  it('rejects schemas exceeding 64KB size limit', () => {
    const largeObject: Record<string, unknown> = {};
    for (let i = 0; i < 2000; i++) {
      largeObject[`field_${i}`] = {
        type: 'string',
        description: 'A'.repeat(50),
      };
    }

    const bloatedTool: McpTool = {
      name: 'bloated',
      inputSchema: {
        type: 'object',
        properties: largeObject as any,
      },
    };

    expect(() => validateMcpToolSchema(bloatedTool)).toThrow(McpSecurityError);
  });

  it('rejects schemas with excessive property counts', () => {
    const manyProperties: Record<string, unknown> = {};
    for (let i = 0; i < 150; i++) {
      manyProperties[`prop_${i}`] = { type: 'string' };
    }

    const wideTool: McpTool = {
      name: 'wide',
      inputSchema: {
        type: 'object',
        properties: manyProperties as any,
      },
    };

    expect(() => validateMcpToolSchema(wideTool)).toThrow(McpSecurityError);
  });
});
