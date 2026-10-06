import type { ToolDefinition } from './types.js';

export const BUILT_IN_TOOLS: readonly ToolDefinition[] = Object.freeze([
  {
    toolId: 'oicunt.tool.computation.evaluate',
    displayName: 'Math Expression Evaluator',
    description: 'Evaluates deterministic mathematical arithmetic expressions.',
    version: '1.0.0',
    category: 'computation',
    source: 'internal',
    capabilities: {
      isReadOnly: true,
      hasSideEffects: false,
      requiresConfirmation: false,
      networkEgress: false,
      accessesSensitiveData: false,
    },
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression to evaluate (e.g. "(10 + 5) * 2")',
        },
      },
      required: ['expression'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        result: { type: 'number' },
        expression: { type: 'string' },
      },
    },
    timeoutPolicy: {
      defaultTimeoutMs: 5000,
      maxTimeoutMs: 15000,
    },
    status: 'active',
    tags: ['computation', 'math', 'core', 'billy'],
  },
  {
    toolId: 'oicunt.tool.computation.format_string',
    displayName: 'String Formatter',
    description: 'Transforms string casing, trimming, or generates URL slugs.',
    version: '1.0.0',
    category: 'computation',
    source: 'internal',
    capabilities: {
      isReadOnly: true,
      hasSideEffects: false,
      requiresConfirmation: false,
      networkEgress: false,
      accessesSensitiveData: false,
    },
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Input string to transform',
        },
        operation: {
          type: 'string',
          enum: ['uppercase', 'lowercase', 'trim', 'slugify'],
          description: 'Transformation operation',
        },
      },
      required: ['text', 'operation'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        formatted: { type: 'string' },
        original: { type: 'string' },
        operation: { type: 'string' },
      },
    },
    timeoutPolicy: {
      defaultTimeoutMs: 5000,
      maxTimeoutMs: 15000,
    },
    status: 'active',
    tags: ['computation', 'text', 'core'],
  },
  {
    toolId: 'oicunt.tool.computation.date_diff',
    displayName: 'Date Difference Calculator',
    description: 'Calculates the difference between two ISO-8601 dates.',
    version: '1.0.0',
    category: 'computation',
    source: 'internal',
    capabilities: {
      isReadOnly: true,
      hasSideEffects: false,
      requiresConfirmation: false,
      networkEgress: false,
      accessesSensitiveData: false,
    },
    parameters: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date (ISO-8601)',
        },
        endDate: {
          type: 'string',
          description: 'End date (ISO-8601)',
        },
      },
      required: ['startDate', 'endDate'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        diffMs: { type: 'number' },
        diffSeconds: { type: 'number' },
        diffMinutes: { type: 'number' },
        diffHours: { type: 'number' },
        diffDays: { type: 'number' },
      },
    },
    timeoutPolicy: {
      defaultTimeoutMs: 5000,
      maxTimeoutMs: 15000,
    },
    status: 'active',
    tags: ['computation', 'date', 'core'],
  },
  {
    toolId: 'oicunt.tool.system.echo',
    displayName: 'System Echo',
    description: 'Echoes input arguments back for platform diagnostics and latency probing.',
    version: '1.0.0',
    category: 'system',
    source: 'internal',
    capabilities: {
      isReadOnly: true,
      hasSideEffects: false,
      requiresConfirmation: false,
      networkEgress: false,
      accessesSensitiveData: false,
    },
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Message to echo',
        },
      },
      additionalProperties: true,
    },
    timeoutPolicy: {
      defaultTimeoutMs: 5000,
      maxTimeoutMs: 15000,
    },
    status: 'active',
    tags: ['system', 'diagnostic', 'core'],
  },
]);
