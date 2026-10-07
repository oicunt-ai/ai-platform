import { randomUUID } from 'node:crypto';
import type { RegisterServerDto } from '../dtos/mcp.dto.js';
import type { McpServerRegistration } from '../../domain/types.js';
import { McpInvalidRequestError, McpServerConflictError } from '../../domain/errors.js';
import { sanitizeIdentifier } from '../../domain/values/identity.js';
import type { McpServerRepositoryPort } from '../ports/mcp-server-repository.port.js';
import {
  validateAuthSecretRef,
  validateTransportHeaders,
} from '../../infrastructure/security/secret-guard.js';
import {
  validateStdioCommand,
  validateStdioArgs,
  DEFAULT_ALLOWED_STDIO_EXECUTABLES,
} from '../../infrastructure/security/stdio-guard.js';

export class RegisterServerUseCase {
  constructor(
    private readonly repository: McpServerRepositoryPort,
    private readonly allowedStdioExecutables: readonly string[] = DEFAULT_ALLOWED_STDIO_EXECUTABLES,
  ) {}

  public async execute(dto: RegisterServerDto): Promise<McpServerRegistration> {
    if (!dto.tenantId?.trim()) {
      throw new McpInvalidRequestError('tenantId is required');
    }
    if (!dto.name?.trim()) {
      throw new McpInvalidRequestError('name is required');
    }
    if (!dto.transportType) {
      throw new McpInvalidRequestError('transportType is required');
    }
    if (!dto.transportConfig) {
      throw new McpInvalidRequestError('transportConfig is required');
    }

    if (dto.authSecretRef) {
      validateAuthSecretRef(dto.authSecretRef);
    }

    // Check existing server with same name in tenant
    const existing = await this.repository.findByName(dto.name.trim(), dto.tenantId);
    if (existing) {
      throw new McpServerConflictError(dto.name.trim(), dto.tenantId);
    }

    const sanitizedName = sanitizeIdentifier(dto.name);
    if (!sanitizedName) {
      throw new McpInvalidRequestError('Server name must contain alphanumeric characters');
    }

    // Form deterministic serverId scoped to tenant
    const serverId = `${sanitizedName}_${randomUUID().slice(0, 8)}`;

    this.validateTransportConfig(dto.transportType, dto.transportConfig);

    const now = new Date().toISOString();
    const registration: McpServerRegistration = {
      serverId,
      tenantId: dto.tenantId,
      name: dto.name.trim(),
      description: dto.description?.trim(),
      transportType: dto.transportType,
      transportConfig: dto.transportConfig,
      authSecretRef: dto.authSecretRef?.trim(),
      status: 'inactive',
      protocolVersion: '2024-11-05',
      capabilities: {},
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.save(registration);
    return registration;
  }

  private validateTransportConfig(
    transportType: string,
    transportConfig: RegisterServerDto['transportConfig'],
  ): void {
    if (transportConfig.type !== transportType) {
      throw new McpInvalidRequestError(
        `Transport config type '${transportConfig.type}' does not match transportType '${transportType}'`,
      );
    }

    switch (transportConfig.type) {
      case 'streamable_http':
      case 'sse': {
        const url = transportConfig.config?.url;
        if (!url || typeof url !== 'string') {
          throw new McpInvalidRequestError(`URL is required for ${transportType} transport`);
        }
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new McpInvalidRequestError(
              `Invalid URL protocol '${parsed.protocol}'. Only http: and https: are allowed.`,
            );
          }
        } catch (err) {
          if (err instanceof McpInvalidRequestError) throw err;
          throw new McpInvalidRequestError(`Invalid URL provided: ${url}`);
        }
        validateTransportHeaders(transportConfig.config?.headers);
        break;
      }
      case 'stdio': {
        const command = transportConfig.config?.command;
        if (!command || typeof command !== 'string' || !command.trim()) {
          throw new McpInvalidRequestError('Command is required for stdio transport');
        }
        validateStdioCommand(command, this.allowedStdioExecutables);
        validateStdioArgs(transportConfig.config?.args);
        break;
      }
      default:
        throw new McpInvalidRequestError(`Unsupported transport type '${transportType}'`);
    }
  }
}
