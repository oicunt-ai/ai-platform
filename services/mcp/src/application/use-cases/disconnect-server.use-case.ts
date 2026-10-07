import { McpInvalidRequestError, McpServerNotFoundError } from '../../domain/errors.js';
import type { McpServerRepositoryPort } from '../ports/mcp-server-repository.port.js';
import type { McpClientRuntimePort } from '../ports/mcp-client-runtime.port.js';

export class DisconnectServerUseCase {
  constructor(
    private readonly repository: McpServerRepositoryPort,
    private readonly clientRuntime: McpClientRuntimePort,
  ) {}

  public async execute(serverId: string, tenantId: string): Promise<void> {
    if (!serverId?.trim()) {
      throw new McpInvalidRequestError('serverId is required');
    }
    if (!tenantId?.trim()) {
      throw new McpInvalidRequestError('tenantId is required');
    }

    const server = await this.repository.findById(serverId.trim(), tenantId.trim());
    if (!server) {
      throw new McpServerNotFoundError(serverId);
    }

    await this.clientRuntime.disconnectSession(server.serverId);
    await this.repository.updateStatus(server.serverId, server.tenantId, 'disconnected');
  }
}
