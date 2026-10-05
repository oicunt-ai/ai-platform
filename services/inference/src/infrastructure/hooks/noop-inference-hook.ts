import type { InferenceHookPort } from '../../application/ports/inference-hook.port.js';
import type { InferenceExecutionRequest } from '../../application/dtos/inference-execution.dto.js';
import type { InferenceResultData } from '../../application/dtos/inference-result.dto.js';

/**
 * Default no-op implementation of InferenceHookPort.
 */
export class NoopInferenceHook implements InferenceHookPort {
  public async beforeExecution(
    _request: InferenceExecutionRequest,
    _signal?: AbortSignal,
  ): Promise<void> {
    // No-op
  }

  public async afterExecution(
    _request: InferenceExecutionRequest,
    _result: InferenceResultData,
    _signal?: AbortSignal,
  ): Promise<void> {
    // No-op
  }
}
