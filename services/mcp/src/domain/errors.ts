export class McpDomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly details?: unknown | undefined;

  constructor(
    message: string,
    code = 'MCP_ERROR',
    statusCode = 500,
    retryable = false,
    details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class McpServerNotFoundError extends McpDomainError {
  constructor(serverId: string) {
    super(`MCP Server '${serverId}' not found`, 'MCP_SERVER_NOT_FOUND', 404, false);
  }
}

export class McpServerConflictError extends McpDomainError {
  constructor(name: string, tenantId: string) {
    super(
      `MCP Server with name '${name}' already exists in tenant '${tenantId}'`,
      'MCP_SERVER_CONFLICT',
      409,
      false,
    );
  }
}

export class McpInvalidRequestError extends McpDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'INVALID_REQUEST', 400, false, details);
  }
}

export class McpSecurityError extends McpDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'SECURITY_VIOLATION', 403, false, details);
  }
}

export class McpConnectionError extends McpDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'MCP_CONNECTION_ERROR', 503, true, details);
  }
}

export class McpTimeoutError extends McpDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'MCP_TIMEOUT', 504, true, details);
  }
}

export class McpDiscoveryError extends McpDomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'MCP_DISCOVERY_ERROR', 502, true, details);
  }
}

export class McpExecutionError extends McpDomainError {
  constructor(message: string, retryable = false, details?: unknown) {
    super(message, 'MCP_EXECUTION_ERROR', 502, retryable, details);
  }
}

export class McpProtocolError extends McpDomainError {
  public readonly rpcCode: number;

  constructor(message: string, rpcCode = -32603, details?: unknown) {
    super(message, 'MCP_PROTOCOL_ERROR', 502, false, details);
    this.rpcCode = rpcCode;
  }
}
