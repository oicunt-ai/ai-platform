import type {
  ChatMessage,
  FinishReason,
  NormalizedCompletionData,
  StreamEvent,
  TextPart,
} from '@oicunt-ai/ai-types';
import type { ResolvedTargetDto } from '../../../application/dtos/dispatch.dto.js';
import type {
  IProviderAdapter,
  ProviderExecutionRequest,
} from '../../../application/ports/provider-adapter.port.js';
import {
  ModelUnavailableError,
  ProviderAuthenticationError,
  RequestCancelledError,
  UnsupportedCapabilityError,
} from '../../../domain/errors.js';
import { mapAnthropicError } from './anthropic-error.mapper.js';
import type {
  AnthropicContentBlock,
  AnthropicErrorResponse,
  AnthropicMessageParam,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicStopReason,
} from './anthropic.types.js';

export interface AnthropicAdapterConfig {
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly defaultTimeoutMs?: number | undefined;
}

/**
 * Concrete provider adapter for Anthropic Messages API v1.
 * Encapsulates credentials, HTTP transport, and schema normalization
 * strictly within the Model Gateway provider boundary.
 */
export class AnthropicProviderAdapter implements IProviderAdapter {
  public readonly provider = 'anthropic';
  private readonly defaultBaseUrl = 'https://api.anthropic.com';
  private readonly anthropicVersion = '2023-06-01';
  private readonly apiKey?: string | undefined;
  private readonly baseUrl: string;

  constructor(config: AnthropicAdapterConfig = {}) {
    this.apiKey = config.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    this.baseUrl = (
      config.baseUrl ??
      process.env['ANTHROPIC_BASE_URL'] ??
      this.defaultBaseUrl
    ).replace(/\/+$/, '');
  }

  /**
   * Executes a synchronous model completion using Anthropic Messages API.
   */
  public async executeUnary(request: ProviderExecutionRequest): Promise<NormalizedCompletionData> {
    if (request.cancellationSignal.aborted) {
      throw new RequestCancelledError(request.payload.canonicalModelId, request.correlationId);
    }

    // 1. Resolve Provider Credentials
    const apiKey = (request.target.adapterOptions?.['apiKey'] as string | undefined) ?? this.apiKey;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ProviderAuthenticationError(
        request.payload.canonicalModelId,
        request.correlationId,
        request.target.targetId,
      );
    }

    const baseUrl =
      (request.target.adapterOptions?.['baseUrl'] as string | undefined) ?? this.baseUrl;

    // 2. Prepare System Prompt & Chat Messages
    let systemPrompt: string | undefined;
    const anthropicMessages: AnthropicMessageParam[] = [];

    for (const msg of request.payload.messages) {
      if (msg.role === 'system') {
        const text = this.extractMessageText(msg);
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${text}` : text;
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        anthropicMessages.push(this.mapMessageToAnthropic(msg));
      }
    }

    // Anthropic requires at least one user or assistant message
    if (anthropicMessages.length === 0) {
      anthropicMessages.push({
        role: 'user',
        content: [{ type: 'text', text: '' }],
      });
    }

    // 3. Resolve Execution Hyperparameters
    const maxTokens =
      request.payload.parameters?.maxTokens ??
      (request.target.adapterOptions?.['maxTokens'] as number | undefined) ??
      request.payload.limits.maxOutputTokens ??
      4096;

    const requestBody: AnthropicMessagesRequest = {
      model: request.target.upstreamModelId,
      messages: anthropicMessages,
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(request.payload.parameters?.temperature !== undefined
        ? { temperature: request.payload.parameters.temperature }
        : {}),
      ...(request.payload.parameters?.topP !== undefined
        ? { top_p: request.payload.parameters.topP }
        : {}),
      ...(request.payload.parameters?.topK !== undefined
        ? { top_k: request.payload.parameters.topK }
        : {}),
      ...(request.payload.parameters?.stopSequences
        ? { stop_sequences: request.payload.parameters.stopSequences }
        : {}),
    };

    // 4. Dispatch HTTP Request to Anthropic Messages API
    const url = `${baseUrl}/v1/messages`;
    const startTime = Date.now();
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': this.anthropicVersion,
          'x-correlation-id': request.correlationId,
          'x-request-id': request.requestId,
        },
        body: JSON.stringify(requestBody),
        signal: request.cancellationSignal,
      });
    } catch (err: unknown) {
      if (request.cancellationSignal.aborted) {
        throw new RequestCancelledError(request.payload.canonicalModelId, request.correlationId);
      }
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        throw new RequestCancelledError(request.payload.canonicalModelId, request.correlationId);
      }
      throw new ModelUnavailableError(
        request.payload.canonicalModelId,
        request.correlationId,
        request.target.targetId,
      );
    }

    // 5. Evaluate Upstream Status & Map Errors
    if (!response.ok) {
      let errorBody: AnthropicErrorResponse | string | undefined;
      try {
        errorBody = (await response.json()) as AnthropicErrorResponse;
      } catch {
        try {
          errorBody = await response.text();
        } catch {
          // Ignore parse failure
        }
      }

      throw mapAnthropicError({
        status: response.status,
        errorBody,
        canonicalModelId: request.payload.canonicalModelId,
        correlationId: request.correlationId,
        targetId: request.target.targetId,
      });
    }

    // 6. Normalize Upstream Response
    const anthropicData = (await response.json()) as AnthropicMessagesResponse;
    const latencyMs = Date.now() - startTime;
    return this.normalizeResponse(anthropicData, request, latencyMs);
  }

  /**
   * Streaming is deferred to subsequent milestones.
   */
  // eslint-disable-next-line require-yield
  public async *executeStream(request: ProviderExecutionRequest): AsyncIterable<StreamEvent> {
    throw new UnsupportedCapabilityError(
      request.payload.canonicalModelId,
      'streaming',
      request.correlationId,
      request.target.targetId,
    );
  }

  /**
   * Performs a health and readiness check for this target.
   */
  public async healthCheck(target: ResolvedTargetDto): Promise<boolean> {
    const key = (target.adapterOptions?.['apiKey'] as string | undefined) ?? this.apiKey;
    return typeof key === 'string' && key.trim().length > 0;
  }

  private mapMessageToAnthropic(msg: ChatMessage): AnthropicMessageParam {
    if (typeof msg.content === 'string') {
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      };
    }

    const blocks: AnthropicContentBlock[] = [];
    for (const part of msg.content) {
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'image') {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: part.mimeType,
            data: part.data,
          },
        });
      } else if (part.type === 'tool_call') {
        blocks.push({
          type: 'tool_use',
          id: part.id,
          name: part.name,
          input: part.arguments,
        });
      } else if (part.type === 'tool_result') {
        blocks.push({
          type: 'tool_result',
          tool_use_id: part.toolCallId,
          content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
          ...(part.isError ? { is_error: true } : {}),
        });
      }
    }

    return {
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }],
    };
  }

  private extractMessageText(msg: ChatMessage): string {
    if (typeof msg.content === 'string') {
      return msg.content;
    }
    return msg.content
      .filter((part): part is TextPart => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
  }

  private normalizeResponse(
    data: AnthropicMessagesResponse,
    request: ProviderExecutionRequest,
    latencyMs: number,
  ): NormalizedCompletionData {
    const textParts: TextPart[] = [];
    for (const block of data.content) {
      if (block.type === 'text') {
        textParts.push({ type: 'text', text: block.text });
      }
    }

    const finishReason = this.mapFinishReason(data.stop_reason);
    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;

    return {
      completionId: request.completionId,
      model: request.payload.canonicalModelId,
      message: {
        role: 'assistant',
        content: textParts.length === 1 && textParts[0] ? textParts[0].text : textParts,
      },
      finishReason,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cachedTokens: data.usage?.cache_read_input_tokens ?? 0,
      },
      latencyMs,
    };
  }

  private mapFinishReason(stopReason: AnthropicStopReason | null): FinishReason {
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}
