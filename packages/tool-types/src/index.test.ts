import { describe, it, expect } from 'vitest';
import {
  ToolExecutionError,
  type ToolDefinition,
  type ToolCall,
  type ToolResult,
} from './index.js';

describe('@oicunt-ai/tool-types', () => {
  it('instantiates ToolExecutionError with toolName and callId', () => {
    const error = new ToolExecutionError('Failed to execute command', 'calculator', 'call_01');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ToolExecutionError');
    expect(error.toolName).toBe('calculator');
    expect(error.callId).toBe('call_01');
    expect(error.message).toBe('Failed to execute command');
  });

  it('validates ToolDefinition structure', () => {
    const definition: ToolDefinition = {
      name: 'get_weather',
      description: 'Get the current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
      isReadOnly: true,
    };
    expect(definition.name).toBe('get_weather');
    expect(definition.isReadOnly).toBe(true);
  });

  it('validates ToolCall and ToolResult structures', () => {
    const call: ToolCall = {
      id: 'call_123',
      name: 'get_weather',
      arguments: { city: 'San Francisco' },
    };
    const result: ToolResult = {
      callId: call.id,
      name: call.name,
      output: { temperature: 18, conditions: 'Sunny' },
      executionDurationMs: 45,
    };
    expect(result.callId).toBe('call_123');
    expect(result.executionDurationMs).toBe(45);
  });
});
