import { describe, expect, it } from 'vitest';
import {
  assertArgumentsConform,
  assertOutputConforms,
  sanitizeToolArguments,
  validateJsonSchemaArguments,
  validateJsonSchemaOutput,
  validateSemVer,
  validateToolDefinition,
  validateToolId,
  InvalidToolArgumentsError,
  MalformedToolResultError,
  type ToolDefinition,
  type ToolOutputSchema,
  type ToolParametersSchema,
} from '../../src/domain/index.js';

describe('Tools Domain Validation', () => {
  describe('validateToolId', () => {
    it('accepts canonical tool IDs', () => {
      expect(() => validateToolId('oicunt.tool.calculator.evaluate')).not.toThrow();
      expect(() => validateToolId('oicunt.tool.search.web_lookup')).not.toThrow();
      expect(() => validateToolId('oicunt.tool.knowledge.query_v2')).not.toThrow();
    });

    it('rejects invalid tool ID formats', () => {
      expect(() => validateToolId('calculator')).toThrow(InvalidToolArgumentsError);
      expect(() => validateToolId('oicunt.calculator')).toThrow(InvalidToolArgumentsError);
      expect(() => validateToolId('oicunt.tool.UPPERCASE')).toThrow(InvalidToolArgumentsError);
      expect(() => validateToolId('')).toThrow(InvalidToolArgumentsError);
    });
  });

  describe('validateSemVer', () => {
    it('accepts valid semantic versions', () => {
      expect(() => validateSemVer('1.0.0')).not.toThrow();
      expect(() => validateSemVer('2.1.3-beta.1')).not.toThrow();
    });

    it('rejects non-semver strings', () => {
      expect(() => validateSemVer('v1.0')).toThrow(InvalidToolArgumentsError);
      expect(() => validateSemVer('latest')).toThrow(InvalidToolArgumentsError);
    });
  });

  describe('validateJsonSchemaArguments', () => {
    const schema: ToolParametersSchema = {
      type: 'object',
      properties: {
        query: { type: 'string', pattern: '^[a-zA-Z0-9 ]+$' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        category: { type: 'string', enum: ['docs', 'faq', 'code'] },
        tags: { type: 'array', items: { type: 'string' } },
        config: {
          type: 'object',
          properties: {
            debug: { type: 'boolean' },
          },
          required: ['debug'],
        },
      },
      required: ['query', 'limit'],
      additionalProperties: false,
    };

    it('validates conforming arguments', () => {
      const result = validateJsonSchemaArguments(schema, {
        query: 'search term',
        limit: 10,
        category: 'docs',
        tags: ['billing', 'auth'],
        config: { debug: true },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when required property is missing', () => {
      const result = validateJsonSchemaArguments(schema, {
        limit: 10,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Missing required parameter 'query'"))).toBe(
        true,
      );
    });

    it('fails on unexpected additional properties when prohibited', () => {
      const result = validateJsonSchemaArguments(schema, {
        query: 'test',
        limit: 5,
        unknownField: 'bad',
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("Disallowed additional property 'unknownField'")),
      ).toBe(true);
    });

    it('fails on out-of-range numbers and wrong enum values', () => {
      const result = validateJsonSchemaArguments(schema, {
        query: 'test',
        limit: 100, // max is 50
        category: 'unknown-category',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('<= 50'))).toBe(true);
      expect(result.errors.some((e) => e.includes('allowed enum'))).toBe(true);
    });
  });

  describe('validateJsonSchemaOutput', () => {
    const outputSchema: ToolOutputSchema = {
      type: 'object',
      properties: {
        count: { type: 'number' },
        items: { type: 'array' },
      },
    };

    it('validates conforming output', () => {
      const result = validateJsonSchemaOutput(outputSchema, {
        count: 2,
        items: ['a', 'b'],
      });
      expect(result.valid).toBe(true);
    });

    it('fails on non-conforming output', () => {
      const result = validateJsonSchemaOutput(outputSchema, {
        count: 'not-a-number',
        items: 'not-an-array',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('sanitizeToolArguments', () => {
    it('redacts sensitive parameters', () => {
      const schema: ToolParametersSchema = {
        type: 'object',
        properties: {
          username: { type: 'string' },
          apiKey: { type: 'string', sensitive: true },
          credentials: {
            type: 'object',
            properties: {
              token: { type: 'string', sensitive: true },
              host: { type: 'string' },
            },
          },
        },
      };

      const sanitized = sanitizeToolArguments(schema, {
        username: 'alice',
        apiKey: 'secret-12345',
        credentials: {
          token: 'token-67890',
          host: 'api.example.com',
        },
      });

      expect(sanitized['username']).toBe('alice');
      expect(sanitized['apiKey']).toBe('[REDACTED_SENSITIVE_ARGUMENT]');
      expect((sanitized['credentials'] as Record<string, unknown>)['token']).toBe(
        '[REDACTED_SENSITIVE_ARGUMENT]',
      );
      expect((sanitized['credentials'] as Record<string, unknown>)['host']).toBe('api.example.com');
    });
  });

  describe('assertArgumentsConform and assertOutputConforms', () => {
    it('throws InvalidToolArgumentsError when arguments do not conform', () => {
      const schema: ToolParametersSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      };
      expect(() => assertArgumentsConform(schema, {})).toThrow(InvalidToolArgumentsError);
      expect(() => assertArgumentsConform(schema, { name: 'valid' })).not.toThrow();
    });

    it('throws MalformedToolResultError when output does not conform', () => {
      const schema: ToolOutputSchema = {
        type: 'object',
        properties: { count: { type: 'number' } },
      };
      expect(() => assertOutputConforms(schema, { count: 'bad' })).toThrow(
        MalformedToolResultError,
      );
      expect(() => assertOutputConforms(schema, { count: 123 })).not.toThrow();
    });

    it('validates tool definitions properly', () => {
      const def: ToolDefinition = {
        toolId: 'oicunt.tool.calc.eval',
        displayName: 'Calc',
        description: 'Calculator',
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
        parameters: { type: 'object', properties: {} },
        timeoutPolicy: { defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
        status: 'active',
        tags: [],
      };
      expect(() => validateToolDefinition(def)).not.toThrow();
    });
  });
});
