import type {
  ExportedTool,
  ToolCategory,
  ToolDefinition,
  ToolExportFormat,
} from '../../domain/index.js';
import { exportTools } from '../../domain/index.js';
import type { ToolCatalogFilter, ToolRepositoryPort } from '../ports/tool-repository.port.js';

export interface DiscoverToolsQuery {
  readonly tenantId: string;
  readonly actorId: string;
  readonly actorRoles?: readonly string[] | undefined;
  readonly product?: string | undefined;
  readonly category?: ToolCategory | undefined;
  readonly capabilities?: string | undefined; // 'read_only' | 'side_effects'
  readonly format?: ToolExportFormat | undefined;
}

export class DiscoverToolsUseCase {
  constructor(private readonly repository: ToolRepositoryPort) {}

  public async execute(query: DiscoverToolsQuery): Promise<readonly ExportedTool[]> {
    const isReadOnlyFilter = query.capabilities === 'read_only' ? true : undefined;
    const hasSideEffectsFilter = query.capabilities === 'side_effects' ? true : undefined;

    const filter: ToolCatalogFilter = {
      tenantId: query.tenantId,
      product: query.product,
      category: query.category,
      status: 'active',
      isReadOnly: isReadOnlyFilter,
      hasSideEffects: hasSideEffectsFilter,
    };

    const allTools = await this.repository.listTools(filter);
    const accessibleTools: ToolDefinition[] = [];

    const actorRoles = new Set(query.actorRoles ?? []);

    for (const tool of allTools) {
      // Check tenant entitlement
      const entitlement = await this.repository.getTenantEntitlement(query.tenantId, tool.toolId);
      if (entitlement && !entitlement.isEnabled) {
        continue;
      }

      // Check RBAC roles if entitlement specifies restrictions
      if (entitlement && entitlement.allowedRoles && entitlement.allowedRoles.length > 0) {
        const hasRequiredRole = entitlement.allowedRoles.some((role) => actorRoles.has(role));
        if (!hasRequiredRole) {
          continue;
        }
      }

      // Check product tag filtering if specified
      if (query.product && !tool.tags.includes(query.product)) {
        continue;
      }

      accessibleTools.push(tool);
    }

    return exportTools(accessibleTools, query.format ?? 'canonical');
  }
}
