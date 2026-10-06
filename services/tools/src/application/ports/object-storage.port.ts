import type { ToolArtifactRef } from '../../domain/index.js';

export interface ObjectStoragePort {
  uploadArtifact(params: {
    readonly tenantId: string;
    readonly executionId: string;
    readonly filename: string;
    readonly content: Buffer | Uint8Array | string;
    readonly mimeType: string;
  }): Promise<ToolArtifactRef>;

  getArtifact(uri: string): Promise<Buffer | null>;
  deleteArtifact(uri: string): Promise<void>;
}
