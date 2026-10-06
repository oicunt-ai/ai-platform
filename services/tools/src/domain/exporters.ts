import type { ToolDefinition } from './types.js';

export type ToolExportFormat = 'canonical' | 'openai' | 'anthropic' | 'gemini' | 'mcp';

export interface OpenAiFunctionDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: ToolDefinition['parameters'];
  };
}

export interface AnthropicToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: ToolDefinition['parameters'];
}

export interface GeminiFunctionDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolDefinition['parameters'];
}

export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolDefinition['parameters'];
}

export type ExportedTool =
  | ToolDefinition
  | OpenAiFunctionDefinition
  | AnthropicToolDefinition
  | GeminiFunctionDeclaration
  | McpToolDescriptor;

export function exportTool(
  tool: ToolDefinition,
  format: ToolExportFormat = 'canonical',
): ExportedTool {
  switch (format) {
    case 'openai':
      return {
        type: 'function',
        function: {
          name: tool.toolId,
          description: tool.description,
          parameters: tool.parameters,
        },
      };

    case 'anthropic':
      return {
        name: tool.toolId,
        description: tool.description,
        input_schema: tool.parameters,
      };

    case 'gemini':
      return {
        name: tool.toolId,
        description: tool.description,
        parameters: tool.parameters,
      };

    case 'mcp':
      return {
        name: tool.toolId,
        description: tool.description,
        inputSchema: tool.parameters,
      };

    case 'canonical':
    default:
      return tool;
  }
}

export function exportTools(
  tools: readonly ToolDefinition[],
  format: ToolExportFormat = 'canonical',
): readonly ExportedTool[] {
  return tools.map((tool) => exportTool(tool, format));
}
