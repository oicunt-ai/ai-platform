export type ToolId = `oicunt.tool.${string}`;

export type ToolCategory =
  'computation' | 'search' | 'knowledge' | 'communication' | 'system' | 'integration' | 'custom';

export type ToolSource = 'internal' | 'service' | 'sandbox' | 'external_api' | 'mcp';

export type ToolStatus = 'draft' | 'active' | 'deprecated' | 'disabled';

export interface ToolCapabilities {
  readonly isReadOnly: boolean;
  readonly hasSideEffects: boolean;
  readonly requiresConfirmation: boolean;
  readonly networkEgress: boolean;
  readonly accessesSensitiveData: boolean;
}

export interface ExecutionTimeoutPolicy {
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
}

export type JsonSchemaTypeName =
  'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

export interface JsonSchemaProperty {
  readonly type: JsonSchemaTypeName;
  readonly description?: string | undefined;
  readonly enum?: readonly (string | number | boolean)[] | undefined;
  readonly items?: JsonSchemaProperty | undefined;
  readonly properties?: Record<string, JsonSchemaProperty> | undefined;
  readonly required?: readonly string[] | undefined;
  readonly default?: unknown | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly pattern?: string | undefined;
  readonly sensitive?: boolean | undefined;
}

export interface ToolParametersSchema {
  readonly type: 'object';
  readonly properties: Record<string, JsonSchemaProperty>;
  readonly required?: readonly string[] | undefined;
  readonly additionalProperties?: boolean | undefined;
}

export interface ToolOutputSchema {
  readonly type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  readonly properties?: Record<string, JsonSchemaProperty> | undefined;
  readonly description?: string | undefined;
}

export interface ToolDefinition {
  readonly toolId: ToolId;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly category: ToolCategory;
  readonly source: ToolSource;
  readonly capabilities: ToolCapabilities;
  readonly parameters: ToolParametersSchema;
  readonly outputSchema?: ToolOutputSchema | undefined;
  readonly timeoutPolicy: ExecutionTimeoutPolicy;
  readonly status: ToolStatus;
  readonly tags: readonly string[];
}

export interface TenantToolEntitlement {
  readonly tenantId: string;
  readonly toolId: ToolId;
  readonly isEnabled: boolean;
  readonly allowedRoles: readonly string[];
  readonly configOverrides?: Record<string, unknown> | undefined;
}

export interface ToolExecutionRequest {
  readonly callId: string;
  readonly toolId: ToolId;
  readonly version?: string | undefined;
  readonly arguments: Record<string, unknown>;
  readonly confirmationToken?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface ToolArtifactRef {
  readonly artifactId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uri: string;
}

export interface ToolErrorDto {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: unknown | undefined;
}

export interface NormalizedToolResultData {
  readonly callId: string;
  readonly toolId: ToolId;
  readonly version: string;
  readonly status: 'success' | 'failure';
  readonly output?: unknown | undefined;
  readonly textSummary?: string | undefined;
  readonly error?: ToolErrorDto | undefined;
  readonly artifacts?: readonly ToolArtifactRef[] | undefined;
  readonly execution: {
    readonly executionId: string;
    readonly durationMs: number;
    readonly isReadOnly: boolean;
    readonly executedAt: string;
  };
}

export interface NormalizedToolResponse {
  readonly success: boolean;
  readonly data: NormalizedToolResultData;
  readonly meta: {
    readonly requestId: string;
    readonly correlationId: string;
    readonly timestamp: string;
  };
}

export interface ToolAuditEvent {
  readonly auditId: string;
  readonly executionId: string;
  readonly timestamp: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly toolId: ToolId;
  readonly version: string;
  readonly isReadOnly: boolean;
  readonly sanitizedArguments: Record<string, unknown>;
  readonly status: 'success' | 'failure';
  readonly durationMs: number;
  readonly confirmationTokenUsed?: string | undefined;
  readonly clientIp?: string | undefined;
  readonly correlationId: string;
}

export type AsyncExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AsyncExecutionJob {
  readonly executionId: string;
  readonly callId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly toolId: ToolId;
  readonly version: string;
  readonly status: AsyncExecutionStatus;
  readonly result?: NormalizedToolResultData | undefined;
  readonly error?: ToolErrorDto | undefined;
  readonly createdAt: string;
  readonly completedAt?: string | undefined;
}

export interface ToolConfirmationChallenge {
  readonly challengeToken: string;
  readonly toolId: ToolId;
  readonly version: string;
  readonly argumentsHash: string;
  readonly expiresAt: string;
}

export interface ToolConfirmationPayload {
  readonly challengeToken: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly toolId: ToolId;
  readonly version: string;
  readonly argumentsHash: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}
