import type {
  AsyncExecutionJob,
  TenantToolEntitlement,
  ToolDefinition,
  ToolId,
} from '../../domain/index.js';
import type {
  ToolCatalogFilter,
  ToolRepositoryPort,
} from '../../application/ports/tool-repository.port.js';

export class InMemoryToolRepository implements ToolRepositoryPort {
  // Key: `${toolId}@${version}`
  private readonly tools = new Map<string, ToolDefinition>();
  // Key: `${tenantId}:${toolId}`
  private readonly entitlements = new Map<string, TenantToolEntitlement>();
  // Key: executionId
  private readonly asyncExecutions = new Map<string, AsyncExecutionJob>();

  public async findById(toolId: ToolId, version?: string): Promise<ToolDefinition | null> {
    if (version) {
      return this.tools.get(`${toolId}@${version}`) ?? null;
    }

    // If no version specified, return latest version
    const matching: ToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      if (tool.toolId === toolId) {
        matching.push(tool);
      }
    }

    if (matching.length === 0) {
      return null;
    }

    // Sort descending by semantic version or publication
    matching.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    return matching[0] ?? null;
  }

  public async listTools(filter?: ToolCatalogFilter): Promise<readonly ToolDefinition[]> {
    const results: ToolDefinition[] = [];
    const latestByToolId = new Map<ToolId, ToolDefinition>();

    // Collect all tools
    for (const tool of this.tools.values()) {
      if (filter?.status && tool.status !== filter.status) {
        continue;
      }
      if (filter?.category && tool.category !== filter.category) {
        continue;
      }
      if (filter?.source && tool.source !== filter.source) {
        continue;
      }
      if (filter?.isReadOnly !== undefined && tool.capabilities.isReadOnly !== filter.isReadOnly) {
        continue;
      }
      if (
        filter?.hasSideEffects !== undefined &&
        tool.capabilities.hasSideEffects !== filter.hasSideEffects
      ) {
        continue;
      }
      if (filter?.product && !tool.tags.includes(filter.product)) {
        continue;
      }
      if (filter?.tag && !tool.tags.includes(filter.tag)) {
        continue;
      }

      // Track latest version per toolId
      const currentLatest = latestByToolId.get(tool.toolId);
      if (
        !currentLatest ||
        tool.version.localeCompare(currentLatest.version, undefined, { numeric: true }) > 0
      ) {
        latestByToolId.set(tool.toolId, tool);
      }
    }

    for (const tool of latestByToolId.values()) {
      results.push(tool);
    }

    return Object.freeze(results);
  }

  public async saveTool(definition: ToolDefinition): Promise<void> {
    this.tools.set(`${definition.toolId}@${definition.version}`, definition);
  }

  public async getTenantEntitlement(
    tenantId: string,
    toolId: ToolId,
  ): Promise<TenantToolEntitlement | null> {
    return this.entitlements.get(`${tenantId}:${toolId}`) ?? null;
  }

  public async setTenantEntitlement(entitlement: TenantToolEntitlement): Promise<void> {
    this.entitlements.set(`${entitlement.tenantId}:${entitlement.toolId}`, entitlement);
  }

  public async createAsyncExecution(job: AsyncExecutionJob): Promise<void> {
    this.asyncExecutions.set(job.executionId, job);
  }

  public async updateAsyncExecution(
    executionId: string,
    update: Partial<AsyncExecutionJob>,
  ): Promise<void> {
    const existing = this.asyncExecutions.get(executionId);
    if (!existing) {
      return;
    }
    this.asyncExecutions.set(executionId, { ...existing, ...update });
  }

  public async getAsyncExecution(executionId: string): Promise<AsyncExecutionJob | null> {
    return this.asyncExecutions.get(executionId) ?? null;
  }

  public clear(): void {
    this.tools.clear();
    this.entitlements.clear();
    this.asyncExecutions.clear();
  }
}
