import { randomUUID } from 'node:crypto';
import type { ToolArtifactRef } from '../../domain/index.js';
import type { ObjectStoragePort } from '../../application/ports/object-storage.port.js';

export class InMemoryObjectStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, { buffer: Buffer; mimeType: string }>();

  public async uploadArtifact(params: {
    readonly tenantId: string;
    readonly executionId: string;
    readonly filename: string;
    readonly content: Buffer | Uint8Array | string;
    readonly mimeType: string;
  }): Promise<ToolArtifactRef> {
    const artifactId = `art_${randomUUID().replace(/-/g, '')}`;
    const uri = `s3://oicunt-artifacts/tenants/${params.tenantId}/artifacts/${params.executionId}/${params.filename}`;

    const buffer = Buffer.isBuffer(params.content)
      ? params.content
      : typeof params.content === 'string'
        ? Buffer.from(params.content, 'utf-8')
        : Buffer.from(params.content);

    this.objects.set(uri, { buffer, mimeType: params.mimeType });

    return {
      artifactId,
      name: params.filename,
      mimeType: params.mimeType,
      sizeBytes: buffer.length,
      uri,
    };
  }

  public async getArtifact(uri: string): Promise<Buffer | null> {
    const item = this.objects.get(uri);
    return item ? item.buffer : null;
  }

  public async deleteArtifact(uri: string): Promise<void> {
    this.objects.delete(uri);
  }

  public clear(): void {
    this.objects.clear();
  }
}
