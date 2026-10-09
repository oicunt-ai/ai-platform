import type { ModelResolutionQuery, ModelResolutionResult } from '../dtos/resolution.dto.js';

/**
 * Outbound port for interacting with the Model Registry (Control Plane).
 */
export interface ModelRegistryPort {
  getCatalog?(
    context: { readonly tenantId: string; readonly correlationId: string },
    signal?: AbortSignal | undefined,
  ): Promise<unknown>;
  /**
   * Resolves a canonical model identity, validating capabilities, effort levels,
   * context limits, and eligible provider targets.
   */
  resolveModel(
    query: ModelResolutionQuery,
    signal?: AbortSignal | undefined,
  ): Promise<ModelResolutionResult>;

  /**
   * Probes health and reachability of the Model Registry service.
   */
  checkHealth(signal?: AbortSignal | undefined): Promise<boolean>;
}
