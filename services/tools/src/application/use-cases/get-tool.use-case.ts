import type { ToolDefinition, ToolId } from '../../domain/index.js';
import { PermissionDeniedError, ToolDisabledError, ToolNotFoundError } from '../../domain/index.js';
import type { ToolRepositoryPort } from '../ports/tool-repository.port.js';

export interface GetToolQuery {
  readonly toolId: ToolId;
  readonly version?: string | undefined;
  readonly tenantId: string;
  readonly actorId: string;
  readonly actorRoles?: readonly string[] | undefined;
}

export class GetToolUseCase {
  constructor(private readonly repository: ToolRepositoryPort) {}

  public async execute(query: GetToolQuery): Promise<ToolDefinition> {
    const tool = await this.repository.findById(query.toolId, query.version);
    if (!tool) {
      throw new ToolNotFoundError(
        `Tool '${query.toolId}'${query.version ? ` version '${query.version}'` : ''} was not found`,
      );
    }

    if (tool.status === 'disabled') {
      throw new ToolDisabledError(`Tool '${query.toolId}' is currently disabled`);
    }

    // Check tenant entitlement
    const entitlement = await this.repository.getTenantEntitlement(query.tenantId, tool.toolId);
    if (entitlement && !entitlement.isEnabled) {
      throw new ToolDisabledError(
        `Tool '${query.toolId}' is not enabled for tenant '${query.tenantId}'`,
      );
    }

    // Check actor roles
    if (entitlement && entitlement.allowedRoles && entitlement.allowedRoles.length > 0) {
      const actorRoles = new Set(query.actorRoles ?? []);
      const hasRequiredRole = entitlement.allowedRoles.some((role) => actorRoles.has(role));
      if (!hasRequiredRole) {
        throw new PermissionDeniedError(
          `Actor '${query.actorId}' does not have the required role to access tool '${query.toolId}'`,
        );
      }
    }

    return tool;
  }
}
