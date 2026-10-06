import type {
  EmbeddingDispatchPayload,
  EmbeddingDispatchResult,
  ModelGatewayPort,
} from '../../application/ports/model-gateway.port.js';
import { DeadlineExceededError, RequestCancelledError } from '../../domain/errors.js';

export interface MockModelGatewayOptions {
  forceError?: Error;
  delayMs?: number;
  overrideDimensions?: number;
  overrideVectorCount?: number;
}

export class MockModelGatewayClient implements ModelGatewayPort {
  public options: MockModelGatewayOptions = {};
  public shouldFailHealth = false;
  public lastDispatchedPayload: EmbeddingDispatchPayload | null = null;

  constructor(options: MockModelGatewayOptions = {}) {
    this.options = options;
  }

  public async dispatchEmbeddings(
    payload: EmbeddingDispatchPayload,
    signal?: AbortSignal,
  ): Promise<EmbeddingDispatchResult> {
    this.lastDispatchedPayload = payload;

    if (signal?.aborted) {
      throw new RequestCancelledError('Request cancelled prior to dispatching');
    }

    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), this.options.delayMs);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new RequestCancelledError('Aborted during delay'));
          });
        }
      });
    }

    if (payload.deadlineMs !== undefined && Date.now() >= payload.deadlineMs) {
      throw new DeadlineExceededError('Monotonic deadline exceeded during dispatch');
    }

    if (this.options.forceError) {
      throw this.options.forceError;
    }

    // Determine target dimension
    const dimensions = this.options.overrideDimensions ?? payload.dimensions ?? 1536;

    // Determine vector count
    const vectorCount = this.options.overrideVectorCount ?? payload.inputs.length;

    const vectors: (readonly number[])[] = [];
    let promptTokens = 0;

    for (let i = 0; i < vectorCount; i++) {
      const input = payload.inputs[i] ?? `mock-input-${i}`;
      // Approximate 1 token per 4 characters (min 1)
      promptTokens += Math.max(1, Math.ceil(input.length / 4));

      // Generate deterministic normalized mock float vector
      const vector: number[] = new Array(dimensions);
      let normSq = 0;
      for (let d = 0; d < dimensions; d++) {
        // Deterministic pseudo-random value based on item index and dimension
        const val = Math.sin((i + 1) * 31 + (d + 1) * 17);
        vector[d] = val;
        normSq += val * val;
      }
      const norm = Math.sqrt(normSq) || 1;
      for (let d = 0; d < dimensions; d++) {
        vector[d] = Math.round((vector[d]! / norm) * 100000) / 100000;
      }
      vectors.push(vector);
    }

    return {
      vectors,
      usage: {
        promptTokens,
        totalTokens: promptTokens,
      },
      targetUsed: payload.eligibleTargets[0]?.targetId ?? 'mock-target',
      providerUsed: payload.eligibleTargets[0]?.provider ?? 'mock-provider',
    };
  }

  public async checkHealth(_signal?: AbortSignal): Promise<boolean> {
    return !this.shouldFailHealth;
  }
}
