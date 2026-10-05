import type { ModelResolutionResult } from '../../application/dtos/resolution.dto.js';
import type { ResolutionCachePort } from '../../application/ports/resolution-cache.port.js';

interface CacheEntry {
  readonly value: ModelResolutionResult;
  readonly expiresAt: number;
}

export class InMemoryResolutionCache implements ResolutionCachePort {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly defaultTtlSeconds: number;
  private readonly maxEntries: number;

  constructor(defaultTtlSeconds = 45, maxEntries = 1000) {
    this.defaultTtlSeconds = defaultTtlSeconds;
    this.maxEntries = maxEntries;
  }

  public get(key: string): ModelResolutionResult | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }

    // Refresh position for LRU
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  public set(key: string, value: ModelResolutionResult, ttlSeconds?: number): void {
    const effectiveTtl = ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = Date.now() + effectiveTtl * 1000;

    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      // Evict oldest entry (LRU)
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, { value, expiresAt });
  }

  public delete(key: string): void {
    this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }
}
