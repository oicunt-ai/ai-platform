import { describe, expect, it } from 'vitest';
import { BUILT_IN_TOOLS, exportTool } from '../../src/domain/index.js';

describe('Tools Schema Exporters', () => {
  const tool = BUILT_IN_TOOLS[0]!;

  it('exports canonical schema untouched', () => {
    const exported = exportTool(tool, 'canonical');
    expect(exported).toEqual(tool);
  });

  it('exports to OpenAI functions format', () => {
    const exported = exportTool(tool, 'openai');
    expect(exported).toHaveProperty('type', 'function');
    expect(exported).toHaveProperty('function');
    const fn = (exported as { function: { name: string; parameters: unknown } }).function;
    expect(fn.name).toBe(tool.toolId);
    expect(fn.parameters).toEqual(tool.parameters);
  });

  it('exports to Anthropic tools format', () => {
    const exported = exportTool(tool, 'anthropic') as {
      name: string;
      description: string;
      input_schema: unknown;
    };
    expect(exported.name).toBe(tool.toolId);
    expect(exported.input_schema).toEqual(tool.parameters);
  });

  it('exports to Gemini function declaration format', () => {
    const exported = exportTool(tool, 'gemini') as {
      name: string;
      description: string;
      parameters: unknown;
    };
    expect(exported.name).toBe(tool.toolId);
    expect(exported.parameters).toEqual(tool.parameters);
  });

  it('exports to MCP tool descriptor format', () => {
    const exported = exportTool(tool, 'mcp') as {
      name: string;
      description: string;
      inputSchema: unknown;
    };
    expect(exported.name).toBe(tool.toolId);
    expect(exported.inputSchema).toEqual(tool.parameters);
  });
});
