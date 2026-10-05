import type { CanonicalModelId } from '@oicunt-ai/model-types';
import type { CanonicalModel } from '../../domain/index.js';

export interface ModelRepositoryPort {
  findById(id: CanonicalModelId): Promise<CanonicalModel | null>;
  listAll(): Promise<readonly CanonicalModel[]>;
  save(model: CanonicalModel, expectedVersionLock?: number): Promise<void>;
  exists(id: CanonicalModelId): Promise<boolean>;
}
