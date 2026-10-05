import type { CanonicalModelId } from '@oicunt-ai/model-types';
import type { ModelResolutionResponse } from '../../application/dtos/resolution.dto.js';
import type { ModelCachePort } from '../../application/ports/model-cache.port.js';

interface CacheEntry {
  readonly response: ModelResolutionResponse;
  readonly expiresAt: number;
}

export interface InMemoryModelCacheOptions {
  readonly defaultTtlSeconds?: number | undefined;
}

export class InMemoryModelCache implements ModelCachePort {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly defaultTtlSeconds: number;

  constructor(options: InMemoryModelCacheOptions = {}) {
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 60;
  }

  public async getResolution(key: string): Promise<ModelResolutionResponse | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.response;
  }

  public async setResolution(
    key: string,
    response: ModelResolutionResponse,
    ttlSeconds?: number,
  ): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    this.cache.set(key, {
      response,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  public async invalidateModel(canonicalModelId: CanonicalModelId): Promise<void> {
    const prefix = `${canonicalModelId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) || key === canonicalModelId) {
        this.cache.delete(key);
      }
    }
  }

  public async clear(): Promise<void> {
    this.cache.clear();
  }
}
