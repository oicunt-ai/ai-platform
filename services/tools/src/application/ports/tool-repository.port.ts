import type {
  AsyncExecutionJob,
  TenantToolEntitlement,
  ToolCategory,
  ToolDefinition,
  ToolId,
  ToolSource,
  ToolStatus,
} from '../../domain/index.js';

export interface ToolCatalogFilter {
  readonly tenantId?: string | undefined;
  readonly product?: string | undefined;
  readonly category?: ToolCategory | undefined;
  readonly source?: ToolSource | undefined;
  readonly status?: ToolStatus | undefined;
  readonly isReadOnly?: boolean | undefined;
  readonly hasSideEffects?: boolean | undefined;
  readonly tag?: string | undefined;
}

export interface ToolRepositoryPort {
  findById(toolId: ToolId, version?: string): Promise<ToolDefinition | null>;
  listTools(filter?: ToolCatalogFilter): Promise<readonly ToolDefinition[]>;
  saveTool(definition: ToolDefinition): Promise<void>;

  getTenantEntitlement(tenantId: string, toolId: ToolId): Promise<TenantToolEntitlement | null>;
  setTenantEntitlement(entitlement: TenantToolEntitlement): Promise<void>;

  createAsyncExecution(job: AsyncExecutionJob): Promise<void>;
  updateAsyncExecution(executionId: string, update: Partial<AsyncExecutionJob>): Promise<void>;
  getAsyncExecution(executionId: string): Promise<AsyncExecutionJob | null>;
}
