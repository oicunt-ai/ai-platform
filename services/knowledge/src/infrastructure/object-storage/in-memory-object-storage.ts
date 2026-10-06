import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type {
  ObjectStoragePort,
  StoredObjectMetadata,
} from '../../application/ports/object-storage.port.js';

interface StoredEntry {
  readonly buffer: Buffer;
  readonly metadata: StoredObjectMetadata;
}

export class InMemoryObjectStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, StoredEntry>();

  public async putObject(
    key: string,
    content: Buffer | Readable,
    metadata: { readonly mimeType: string; readonly tenantId: string },
  ): Promise<StoredObjectMetadata> {
    const buffer = Buffer.isBuffer(content) ? content : await this.streamToBuffer(content);

    const hash = createHash('sha256').update(buffer).digest('hex');
    const storedMeta: StoredObjectMetadata = {
      key,
      bucket: 'oicunt-knowledge',
      sizeBytes: buffer.length,
      mimeType: metadata.mimeType,
      hash,
    };

    this.objects.set(key, { buffer, metadata: storedMeta });
    return storedMeta;
  }

  public async getObjectStream(key: string): Promise<Readable> {
    const entry = this.objects.get(key);
    if (!entry) {
      throw new Error(`Object not found in storage: '${key}'`);
    }
    return Readable.from(entry.buffer);
  }

  public async getObject(key: string): Promise<Buffer> {
    const entry = this.objects.get(key);
    if (!entry) {
      throw new Error(`Object not found in storage: '${key}'`);
    }
    return entry.buffer;
  }

  public async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  public async deleteObjectsByPrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
        count++;
      }
    }
    return count;
  }

  public async hasObject(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  public async checkHealth(): Promise<boolean> {
    return true;
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
