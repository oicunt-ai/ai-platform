import type { CanonicalModelId } from '@oicunt-ai/model-types';
import type { ModelResolutionResponse } from '../dtos/resolution.dto.js';

export interface ModelCachePort {
  getResolution(key: string): Promise<ModelResolutionResponse | null>;
  setResolution(key: string, response: ModelResolutionResponse, ttlSeconds?: number): Promise<void>;
  invalidateModel(canonicalModelId: CanonicalModelId): Promise<void>;
  clear(): Promise<void>;
}
