import type { McpServerDetailDto } from '../dtos/mcp.dto.js';
import { McpInvalidRequestError, McpServerNotFoundError } from '../../domain/errors.js';
import type { McpServerRepositoryPort } from '../ports/mcp-server-repository.port.js';

export class GetServerUseCase {
  constructor(private readonly repository: McpServerRepositoryPort) {}

  public async execute(serverId: string, tenantId: string): Promise<McpServerDetailDto> {
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

    const capabilities = await this.repository.getDiscoveredCapabilities(
      serverId.trim(),
      tenantId.trim(),
    );

    return {
      server,
      capabilities,
    };
  }
}
