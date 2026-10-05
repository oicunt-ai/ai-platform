import type { CanonicalModelId } from '@oicunt-ai/model-types';
import type { ModelResolutionResponse } from '../../application/dtos/resolution.dto.js';
import type { ModelCachePort } from '../../application/ports/model-cache.port.js';

export class NoopModelCache implements ModelCachePort {
  public async getResolution(_key: string): Promise<ModelResolutionResponse | null> {
    return null;
  }

  public async setResolution(
    _key: string,
    _response: ModelResolutionResponse,
    _ttlSeconds?: number,
  ): Promise<void> {}

  public async invalidateModel(_canonicalModelId: CanonicalModelId): Promise<void> {}

  public async clear(): Promise<void> {}
}
