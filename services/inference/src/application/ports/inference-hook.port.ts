import type { InferenceExecutionRequest } from '../dtos/inference-execution.dto.js';
import type { InferenceResultData } from '../dtos/inference-result.dto.js';

/**
 * Runtime execution hook port enabling pre/post execution lifecycle interception
 * (e.g. content guardrails, local inference routing, watermarking).
 */
export interface InferenceHookPort {
  /**
   * Hook executed prior to Model Gateway dispatch.
   * Can perform validation, token counting, or reject disallowed requests.
   */
  beforeExecution(request: InferenceExecutionRequest, signal?: AbortSignal): Promise<void>;

  /**
   * Hook executed after successful inference completion.
   */
  afterExecution(
    request: InferenceExecutionRequest,
    result: InferenceResultData,
    signal?: AbortSignal,
  ): Promise<void>;
}
