import type { NormalizedCompletionData, StreamEvent } from '@oicunt-ai/ai-types';
import type { GatewayDispatchPayload, ResolvedTargetDto } from '../dtos/dispatch.dto.js';

export interface ProviderExecutionRequest {
  readonly requestId: string;
  readonly correlationId: string;
  readonly completionId: string;
  readonly target: ResolvedTargetDto;
  readonly payload: GatewayDispatchPayload;
  readonly attemptTimeoutMs: number;
  readonly cancellationSignal: AbortSignal;
}

export interface IProviderAdapter {
  readonly provider: string;

  executeUnary(request: ProviderExecutionRequest): Promise<NormalizedCompletionData>;

  executeStream(request: ProviderExecutionRequest): AsyncIterable<StreamEvent>;

  healthCheck(target: ResolvedTargetDto): Promise<boolean>;
}
