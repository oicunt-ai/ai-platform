import type { StreamEvent } from '@oicunt-ai/ai-types';
import type {
  InferenceExecutionRequest,
  InferenceExecutionResponse,
} from '../dtos/inference.dto.js';

/**
 * Outbound port for interacting with the Inference Service (Runtime Execution Plane).
 */
export interface InferencePort {
  /**
   * Executes a unary completion through the Inference Service.
   */
  executeUnary(
    request: InferenceExecutionRequest,
    signal?: AbortSignal | undefined,
  ): Promise<InferenceExecutionResponse>;

  /**
   * Executes a streaming completion, returning an AsyncIterable of Server-Sent Events.
   */
  executeStream(
    request: InferenceExecutionRequest,
    signal?: AbortSignal | undefined,
  ): AsyncIterable<StreamEvent>;

  /**
   * Probes health and reachability of the Inference Service.
   */
  checkHealth(signal?: AbortSignal | undefined): Promise<boolean>;
}
