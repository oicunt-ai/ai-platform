import { describe, it, expect } from 'vitest';
import {
  MCP_LATEST_PROTOCOL_VERSION,
  McpProtocolError,
  type McpServerDescriptor,
  type McpTool,
} from './index.js';

describe('@oicunt-ai/mcp-types', () => {
  it('exposes the standard protocol version', () => {
    expect(MCP_LATEST_PROTOCOL_VERSION).toBe('2024-11-05');
  });

  it('instantiates McpProtocolError with error code', () => {
    const error = new McpProtocolError('Method not found', -32601);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('McpProtocolError');
    expect(error.rpcCode).toBe(-32601);
    expect(error.message).toBe('Method not found');
  });

  it('validates McpServerDescriptor contract', () => {
    const descriptor: McpServerDescriptor = {
      info: { name: 'filesystem-server', version: '1.0.0' },
      protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true },
      },
    };
    expect(descriptor.info.name).toBe('filesystem-server');
    expect(descriptor.capabilities.tools?.listChanged).toBe(true);
  });

  it('validates McpTool with schema', () => {
    const tool: McpTool = {
      name: 'read_file',
      description: 'Read file contents from disk',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
        },
        required: ['path'],
      },
    };
    expect(tool.name).toBe('read_file');
    expect(tool.inputSchema.properties['path']?.type).toBe('string');
  });
});
