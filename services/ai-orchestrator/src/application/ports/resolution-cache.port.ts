import type { ModelResolutionResult } from '../dtos/resolution.dto.js';

/**
 * Outbound port for L1 in-memory resolution caching.
 */
export interface ResolutionCachePort {
  /**
   * Retrieves a cached model resolution result if present and not expired.
   */
  get(key: string): Promise<ModelResolutionResult | null> | ModelResolutionResult | null;

  /**
   * Stores a model resolution result in the cache with the given TTL in seconds.
   */
  set(key: string, value: ModelResolutionResult, ttlSeconds?: number): Promise<void> | void;

  /**
   * Deletes a cached entry by key.
   */
  delete(key: string): Promise<void> | void;

  /**
   * Clears all cached entries.
   */
  clear(): Promise<void> | void;
}
