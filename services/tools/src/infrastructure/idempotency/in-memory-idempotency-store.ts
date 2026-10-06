import type { NormalizedToolResultData } from '../../domain/index.js';
import type { IdempotencyStorePort } from '../../application/ports/idempotency-store.port.js';

interface LockEntry {
  expiresAt: number;
}

interface CacheEntry {
  result: NormalizedToolResultData;
  expiresAt: number;
}

export class InMemoryIdempotencyStore implements IdempotencyStorePort {
  private readonly locks = new Map<string, LockEntry>();
  private readonly cache = new Map<string, CacheEntry>();

  public async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(key);

    if (existing && existing.expiresAt > now) {
      return false; // lock held
    }

    this.locks.set(key, { expiresAt: now + ttlMs });
    return true;
  }

  public async releaseLock(key: string): Promise<void> {
    this.locks.delete(key);
  }

  public async getCachedResult(key: string): Promise<NormalizedToolResultData | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  public async cacheResult(
    key: string,
    result: NormalizedToolResultData,
    ttlMs: number,
  ): Promise<void> {
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public clear(): void {
    this.locks.clear();
    this.cache.clear();
  }
}
