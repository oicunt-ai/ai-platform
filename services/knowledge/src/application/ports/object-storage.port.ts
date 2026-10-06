import type { Readable } from 'node:stream';

export interface StoredObjectMetadata {
  readonly key: string;
  readonly bucket: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly hash: string;
}

export interface ObjectStoragePort {
  putObject(
    key: string,
    content: Buffer | Readable,
    metadata: { readonly mimeType: string; readonly tenantId: string },
  ): Promise<StoredObjectMetadata>;
  getObjectStream(key: string): Promise<Readable>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  deleteObjectsByPrefix(prefix: string): Promise<number>;
  checkHealth(signal?: AbortSignal): Promise<boolean>;
}
