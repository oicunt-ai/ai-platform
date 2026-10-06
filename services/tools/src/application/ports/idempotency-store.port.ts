import type { NormalizedToolResultData } from '../../domain/index.js';

export interface IdempotencyStorePort {
  acquireLock(key: string, ttlMs: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
  getCachedResult(key: string): Promise<NormalizedToolResultData | null>;
  cacheResult(key: string, result: NormalizedToolResultData, ttlMs: number): Promise<void>;
}
