import { createHash } from 'node:crypto';
import type {
  EmbeddingServicePort,
  EmbeddingRequest,
  EmbeddingResponse,
} from '../../application/ports/embedding-service.port.js';
import { RequestCancelledError } from '../../domain/index.js';

export class MockEmbeddingService implements EmbeddingServicePort {
  public async generateEmbeddings(
    request: EmbeddingRequest,
    signal?: AbortSignal,
  ): Promise<EmbeddingResponse> {
    if (signal?.aborted) {
      throw new RequestCancelledError('Embedding generation cancelled');
    }

    const dimensions = request.dimensions ?? 1536;
    const embeddings: (readonly number[])[] = [];

    for (const text of request.texts) {
      embeddings.push(this.generateDeterministicVector(text, dimensions));
    }

    return {
      embeddings,
      modelId: request.modelId,
      dimensions,
      usage: {
        totalTokens: request.texts.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0),
      },
    };
  }

  public async checkHealth(): Promise<boolean> {
    return true;
  }

  private generateDeterministicVector(text: string, dimensions: number): readonly number[] {
    const vector: number[] = new Array<number>(dimensions);
    // Hash text to create deterministic pseudo-random values
    const hash = createHash('sha256').update(text).digest();

    let sumSquares = 0;
    for (let i = 0; i < dimensions; i++) {
      const byte = hash[i % hash.length]!;
      // Center around 0
      const val = (byte - 128) / 128;
      vector[i] = val;
      sumSquares += val * val;
    }

    // Normalize to unit vector
    const norm = Math.sqrt(sumSquares);
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) {
        vector[i] = vector[i]! / norm;
      }
    }

    return Object.freeze(vector);
  }
}
