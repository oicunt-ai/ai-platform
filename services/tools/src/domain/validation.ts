import type {
  JsonSchemaProperty,
  ToolDefinition,
  ToolOutputSchema,
  ToolParametersSchema,
} from './types.js';
import { InvalidToolArgumentsError, MalformedToolResultError } from './errors.js';

const TOOL_ID_REGEX = /^oicunt\.tool\.[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

export function validateToolId(toolId: string): void {
  if (!toolId || typeof toolId !== 'string') {
    throw new InvalidToolArgumentsError('ToolId must be a non-empty string');
  }
  if (toolId.length > 128) {
    throw new InvalidToolArgumentsError('ToolId must not exceed 128 characters');
  }
  if (!TOOL_ID_REGEX.test(toolId)) {
    throw new InvalidToolArgumentsError(
      `Invalid tool ID format '${toolId}'. Must match 'oicunt.tool.<category>.<action>' using lowercase letters, numbers, and underscores.`,
    );
  }
}

export function validateSemVer(version: string): void {
  if (!version || typeof version !== 'string' || !SEMVER_REGEX.test(version)) {
    throw new InvalidToolArgumentsError(
      `Invalid semantic version '${version}'. Must conform to SemVer (e.g. '1.0.0').`,
    );
  }
}

export function validateToolDefinition(tool: ToolDefinition): void {
  validateToolId(tool.toolId);
  validateSemVer(tool.version);

  if (!tool.displayName || typeof tool.displayName !== 'string' || !tool.displayName.trim()) {
    throw new InvalidToolArgumentsError('Tool displayName must be a non-empty string');
  }
  if (!tool.description || typeof tool.description !== 'string' || !tool.description.trim()) {
    throw new InvalidToolArgumentsError('Tool description must be a non-empty string');
  }
  if (!tool.timeoutPolicy || typeof tool.timeoutPolicy !== 'object') {
    throw new InvalidToolArgumentsError('Tool timeoutPolicy must be defined');
  }
  if (
    typeof tool.timeoutPolicy.defaultTimeoutMs !== 'number' ||
    tool.timeoutPolicy.defaultTimeoutMs <= 0
  ) {
    throw new InvalidToolArgumentsError('timeoutPolicy.defaultTimeoutMs must be a positive number');
  }
  if (
    typeof tool.timeoutPolicy.maxTimeoutMs !== 'number' ||
    tool.timeoutPolicy.maxTimeoutMs < tool.timeoutPolicy.defaultTimeoutMs
  ) {
    throw new InvalidToolArgumentsError(
      'timeoutPolicy.maxTimeoutMs must be greater than or equal to defaultTimeoutMs',
    );
  }
  if (!tool.parameters || tool.parameters.type !== 'object') {
    throw new InvalidToolArgumentsError("Tool parameters schema must have type: 'object'");
  }
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function validateProperty(
  propSchema: JsonSchemaProperty,
  val: unknown,
  path: string,
  errors: string[],
): void {
  if (val === undefined) {
    return;
  }

  // Type check
  switch (propSchema.type) {
    case 'string':
      if (typeof val !== 'string') {
        errors.push(`Property '${path}' must be a string, received ${typeof val}`);
        return;
      }
      if (propSchema.pattern) {
        const regex = new RegExp(propSchema.pattern);
        if (!regex.test(val)) {
          errors.push(`Property '${path}' does not match pattern '${propSchema.pattern}'`);
        }
      }
      break;

    case 'number':
      if (typeof val !== 'number' || Number.isNaN(val)) {
        errors.push(`Property '${path}' must be a number, received ${typeof val}`);
        return;
      }
      if (propSchema.minimum !== undefined && val < propSchema.minimum) {
        errors.push(`Property '${path}' must be >= ${propSchema.minimum}`);
      }
      if (propSchema.maximum !== undefined && val > propSchema.maximum) {
        errors.push(`Property '${path}' must be <= ${propSchema.maximum}`);
      }
      break;

    case 'integer':
      if (typeof val !== 'number' || !Number.isInteger(val)) {
        errors.push(`Property '${path}' must be an integer, received ${typeof val}`);
        return;
      }
      if (propSchema.minimum !== undefined && val < propSchema.minimum) {
        errors.push(`Property '${path}' must be >= ${propSchema.minimum}`);
      }
      if (propSchema.maximum !== undefined && val > propSchema.maximum) {
        errors.push(`Property '${path}' must be <= ${propSchema.maximum}`);
      }
      break;

    case 'boolean':
      if (typeof val !== 'boolean') {
        errors.push(`Property '${path}' must be a boolean, received ${typeof val}`);
        return;
      }
      break;

    case 'null':
      if (val !== null) {
        errors.push(`Property '${path}' must be null, received ${typeof val}`);
        return;
      }
      break;

    case 'array':
      if (!Array.isArray(val)) {
        errors.push(`Property '${path}' must be an array, received ${typeof val}`);
        return;
      }
      if (propSchema.items) {
        for (let i = 0; i < val.length; i++) {
          validateProperty(propSchema.items, val[i], `${path}[${i}]`, errors);
        }
      }
      break;

    case 'object':
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        errors.push(`Property '${path}' must be an object, received ${typeof val}`);
        return;
      }
      if (propSchema.properties) {
        const record = val as Record<string, unknown>;
        if (propSchema.required) {
          for (const reqKey of propSchema.required) {
            if (record[reqKey] === undefined) {
              errors.push(`Missing required property '${path}.${reqKey}'`);
            }
          }
        }
        for (const [key, nestedVal] of Object.entries(record)) {
          if (propSchema.properties[key]) {
            validateProperty(propSchema.properties[key]!, nestedVal, `${path}.${key}`, errors);
          }
        }
      }
      break;
  }

  // Enum check
  if (propSchema.enum && propSchema.enum.length > 0) {
    if (!propSchema.enum.includes(val as string | number | boolean)) {
      errors.push(
        `Property '${path}' value '${String(val)}' is not in allowed enum: [${propSchema.enum.join(', ')}]`,
      );
    }
  }
}

export function validateJsonSchemaArguments(
  schema: ToolParametersSchema,
  args: unknown,
): ValidationResult {
  const errors: string[] = [];

  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return {
      valid: false,
      errors: ['Tool arguments must be an object'],
    };
  }

  const record = args as Record<string, unknown>;

  // Check required parameters
  if (schema.required) {
    for (const reqKey of schema.required) {
      if (record[reqKey] === undefined) {
        errors.push(`Missing required parameter '${reqKey}'`);
      }
    }
  }

  // Check additionalProperties if false
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!schema.properties[key]) {
        errors.push(`Disallowed additional property '${key}'`);
      }
    }
  }

  // Check each property
  for (const [key, val] of Object.entries(record)) {
    const propSchema = schema.properties[key];
    if (propSchema) {
      validateProperty(propSchema, val, key, errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

export function validateJsonSchemaOutput(
  schema: ToolOutputSchema | undefined,
  output: unknown,
): ValidationResult {
  if (!schema) {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];

  switch (schema.type) {
    case 'string':
      if (typeof output !== 'string') {
        errors.push(`Output must be a string, received ${typeof output}`);
      }
      break;

    case 'number':
      if (typeof output !== 'number' || Number.isNaN(output)) {
        errors.push(`Output must be a number, received ${typeof output}`);
      }
      break;

    case 'boolean':
      if (typeof output !== 'boolean') {
        errors.push(`Output must be a boolean, received ${typeof output}`);
      }
      break;

    case 'array':
      if (!Array.isArray(output)) {
        errors.push(`Output must be an array, received ${typeof output}`);
      }
      break;

    case 'object':
      if (typeof output !== 'object' || output === null || Array.isArray(output)) {
        errors.push(`Output must be an object, received ${typeof output}`);
      } else if (schema.properties) {
        const record = output as Record<string, unknown>;
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          const val = record[key];
          if (val !== undefined) {
            validateProperty(propSchema, val, key, errors);
          }
        }
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

export function sanitizeToolArguments(
  schema: ToolParametersSchema,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(args)) {
    const propDef = schema.properties[key];
    if (propDef?.sensitive === true) {
      sanitized[key] = '[REDACTED_SENSITIVE_ARGUMENT]';
    } else if (
      propDef?.type === 'object' &&
      propDef.properties &&
      typeof val === 'object' &&
      val !== null &&
      !Array.isArray(val)
    ) {
      sanitized[key] = sanitizeNestedObject(propDef.properties, val as Record<string, unknown>);
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

function sanitizeNestedObject(
  properties: Record<string, JsonSchemaProperty>,
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const propDef = properties[key];
    if (propDef?.sensitive === true) {
      result[key] = '[REDACTED_SENSITIVE_ARGUMENT]';
    } else if (
      propDef?.type === 'object' &&
      propDef.properties &&
      typeof val === 'object' &&
      val !== null &&
      !Array.isArray(val)
    ) {
      result[key] = sanitizeNestedObject(propDef.properties, val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result;
}

export function assertArgumentsConform(
  schema: ToolParametersSchema,
  args: unknown,
): asserts args is Record<string, unknown> {
  const result = validateJsonSchemaArguments(schema, args);
  if (!result.valid) {
    throw new InvalidToolArgumentsError(
      `Tool arguments failed JSON Schema validation: ${result.errors.join('; ')}`,
      { validationErrors: result.errors },
    );
  }
}

export function assertOutputConforms(schema: ToolOutputSchema | undefined, output: unknown): void {
  const result = validateJsonSchemaOutput(schema, output);
  if (!result.valid) {
    throw new MalformedToolResultError(
      `Tool output failed outputSchema validation: ${result.errors.join('; ')}`,
      { validationErrors: result.errors },
    );
  }
}
