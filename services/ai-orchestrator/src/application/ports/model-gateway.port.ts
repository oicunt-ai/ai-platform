import type { NormalizedCompletionData, StreamEvent } from '@oicunt-ai/ai-types';
import type { GatewayDispatchPayload } from '../dtos/dispatch.dto.js';

/**
 * Outbound port for interacting with the Model Gateway (Data Plane).
 */
export interface ModelGatewayPort {
  /**
   * Executes a unary completion dispatch through the Model Gateway.
   */
  dispatchUnary(
    payload: GatewayDispatchPayload,
    signal?: AbortSignal | undefined,
  ): Promise<NormalizedCompletionData>;

  /**
   * Executes a streaming completion dispatch, returning an AsyncIterable of Server-Sent Events.
   */
  dispatchStream(
    payload: GatewayDispatchPayload,
    signal?: AbortSignal | undefined,
  ): AsyncIterable<StreamEvent>;

  /**
   * Probes health and reachability of the Model Gateway service.
   */
  checkHealth(signal?: AbortSignal | undefined): Promise<boolean>;
}
