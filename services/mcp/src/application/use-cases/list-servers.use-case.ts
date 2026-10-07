import type { McpServerRegistration } from '../../domain/types.js';
import { McpInvalidRequestError } from '../../domain/errors.js';
import type { McpServerRepositoryPort } from '../ports/mcp-server-repository.port.js';

export class ListServersUseCase {
  constructor(private readonly repository: McpServerRepositoryPort) {}

  public async execute(tenantId: string): Promise<readonly McpServerRegistration[]> {
    if (!tenantId?.trim()) {
      throw new McpInvalidRequestError('tenantId is required');
    }

    return this.repository.listByTenant(tenantId.trim());
  }
}
