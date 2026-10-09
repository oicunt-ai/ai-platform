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
} from '../../../domain/errors.js';
import { mapGroqError } from './groq-error.mapper.js';
import type {
  GroqChatCompletionsRequest,
  GroqChatCompletionsResponse,
  GroqChatMessage,
  GroqErrorBody,
} from './groq.types.js';

export interface GroqAdapterConfig {
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly defaultTimeoutMs?: number | undefined;
}

/**
 * Concrete provider adapter for the Groq OpenAI-compatible Chat Completions API.
 * Credentials, HTTP transport, and schema normalization stay strictly within
 * the Model Gateway provider boundary. The API key is read from explicit
 * configuration or the GROQ_API_KEY environment variable only — never from
 * Registry adapter options, logs, or responses.
 */
export class GroqProviderAdapter implements IProviderAdapter {
  public readonly provider = 'groq';
  private readonly defaultBaseUrl = 'https://api.groq.com/openai/v1';
  private readonly apiKey?: string | undefined;
  private readonly baseUrl: string;

  constructor(config: GroqAdapterConfig = {}) {
    this.apiKey = config.apiKey ?? process.env['GROQ_API_KEY'];
    this.baseUrl = (config.baseUrl ?? process.env['GROQ_BASE_URL'] ?? this.defaultBaseUrl).replace(
      /\/+$/,
      '',
    );
  }

  public async executeUnary(request: ProviderExecutionRequest): Promise<NormalizedCompletionData> {
    if (request.cancellationSignal.aborted) {
      throw new RequestCancelledError(request.payload.canonicalModelId, request.correlationId);
    }

    const apiKey = this.apiKey;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ProviderAuthenticationError(
        request.payload.canonicalModelId,
        request.correlationId,
        request.target.targetId,
      );
    }

    const requestBody = this.buildRequestBody(request);
    const url = `${this.baseUrl}/chat/completions`;
    const startTime = Date.now();
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
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

    if (!response.ok) {
      throw mapGroqError({
        status: response.status,
        errorBody: await this.readErrorBody(response),
        canonicalModelId: request.payload.canonicalModelId,
        correlationId: request.correlationId,
        targetId: request.target.targetId,
      });
    }

    let data: GroqChatCompletionsResponse;
    try {
      data = (await response.json()) as GroqChatCompletionsResponse;
    } catch {
      throw new ModelUnavailableError(
        request.payload.canonicalModelId,
        request.correlationId,
        request.target.targetId,
      );
    }

    const choice = data.choices?.[0];
    if (!choice) {
      throw new ModelUnavailableError(
        request.payload.canonicalModelId,
        request.correlationId,
        request.target.targetId,
      );
    }

    const latencyMs = Date.now() - startTime;
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;

    return {
      completionId: request.completionId,
      model: request.payload.canonicalModelId,
      message: {
        role: 'assistant',
        content: this.buildAssistantContent(choice.message?.content, choice.message?.reasoning),
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
        reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
        cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens,
      },
      latencyMs,
    };
  }

  public async *executeStream(request: ProviderExecutionRequest): AsyncIterable<StreamEvent> {
    if (request.cancellationSignal.aborted) {
      throw new RequestCancelledError(request.payload.canonicalModelId, request.correlationId);
    }

    const apiKey = this.apiKey;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ProviderAuthenticationError(
        request.payload.canonicalModelId,
        request.correlationId,
        request.target.targetId,
      );
    }

    const requestBody: GroqChatCompletionsRequest = {
      ...this.buildRequestBody(request),
      stream: true,
      stream_options: { include_usage: true },
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          authorization: `Bearer ${apiKey}`,
          'x-correlation-id': request.correlationId,
          'x-request-id': request.requestId,
        },
        body: JSON.stringify(requestBody),
        signal: request.cancellationSignal,
      });
    } catch (_err: unknown) {
      if (request.cancellationSignal.aborted) {
        throw new RequestCancelledError(request.payload.canonicalModelId, request.correlationId);
      }
      throw new ModelUnavailableError(
        request.payload.canonicalModelId,
        request.correlationId,
        request.target.targetId,
      );
    }

    if (!response.ok) {
      throw mapGroqError({
        status: response.status,
        errorBody: await this.readErrorBody(response),
        canonicalModelId: request.payload.canonicalModelId,
        correlationId: request.correlationId,
        targetId: request.target.targetId,
      });
    }

    if (!response.body) {
      throw new ModelUnavailableError(
        request.payload.canonicalModelId,
        request.correlationId,
        request.target.targetId,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens: number | undefined;
    let reasoningTokens: number | undefined;
    let cachedTokens: number | undefined;
    let finishReason: FinishReason = 'stop';

    try {
      while (true) {
        if (request.cancellationSignal.aborted) {
          throw new RequestCancelledError(request.payload.canonicalModelId, request.correlationId);
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

          const chunk = parsed as {
            choices?: readonly {
              readonly delta?:
                | {
                    readonly content?: string | null | undefined;
                    readonly reasoning?: string | null | undefined;
                  }
                | undefined;
              readonly finish_reason?: string | null | undefined;
            }[];
            usage?: GroqChatCompletionsResponse['usage'];
            error?: { readonly message?: string | undefined } | undefined;
          };

          if (chunk.error) {
            yield {
              event: 'error',
              data: { code: 'PROVIDER_ERROR', message: 'Groq stream error' },
            };
            continue;
          }

          const delta = chunk.choices?.[0]?.delta;
          if (typeof delta?.content === 'string' && delta.content.length > 0) {
            yield { event: 'token', data: { delta: delta.content } };
          }
          if (typeof delta?.reasoning === 'string' && delta.reasoning.length > 0) {
            yield { event: 'thinking', data: { delta: delta.reasoning } };
          }

          const streamFinish = chunk.choices?.[0]?.finish_reason;
          if (streamFinish) {
            finishReason = this.mapFinishReason(streamFinish);
          }

          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
            completionTokens = chunk.usage.completion_tokens ?? completionTokens;
            totalTokens = chunk.usage.total_tokens ?? totalTokens;
            reasoningTokens =
              chunk.usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens;
            cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? cachedTokens;
          }
        }
      }

      yield {
        event: 'finish',
        data: {
          finishReason,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: totalTokens ?? promptTokens + completionTokens,
            reasoningTokens,
            cachedTokens,
          },
        },
      };
    } catch (err: unknown) {
      if (
        request.cancellationSignal.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw new RequestCancelledError(request.payload.canonicalModelId, request.correlationId);
      }
      throw err;
    } finally {
      reader.releaseLock();
    }
  }

  public async healthCheck(target: ResolvedTargetDto): Promise<boolean> {
    void target;
    const key = this.apiKey;
    return typeof key === 'string' && key.trim().length > 0;
  }

  private buildRequestBody(request: ProviderExecutionRequest): GroqChatCompletionsRequest {
    const messages: GroqChatMessage[] = [];
    for (const msg of request.payload.messages) {
      if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: this.extractText(msg) });
      } else if (msg.role === 'tool') {
        messages.push({ role: 'tool', content: this.extractText(msg) });
      }
    }
    if (messages.length === 0) {
      messages.push({ role: 'user', content: '' });
    }

    const parameters = request.payload.parameters;
    const maxTokens = parameters?.maxTokens ?? request.payload.limits.maxOutputTokens ?? 4096;

    return {
      model: request.target.upstreamModelId,
      messages,
      ...(parameters?.temperature !== undefined ? { temperature: parameters.temperature } : {}),
      ...(parameters?.topP !== undefined ? { top_p: parameters.topP } : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(parameters?.stopSequences ? { stop: [...parameters.stopSequences] } : {}),
      ...(parameters?.seed !== undefined ? { seed: parameters.seed } : {}),
      ...(parameters?.presencePenalty !== undefined
        ? { presence_penalty: parameters.presencePenalty }
        : {}),
      ...(parameters?.frequencyPenalty !== undefined
        ? { frequency_penalty: parameters.frequencyPenalty }
        : {}),
      ...(request.payload.effort ? { reasoning_effort: request.payload.effort } : {}),
    };
  }

  private extractText(msg: ChatMessage): string {
    if (typeof msg.content === 'string') return msg.content;
    return msg.content
      .filter((part): part is TextPart => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
  }

  private buildAssistantContent(
    content: string | null | undefined,
    reasoning: string | null | undefined,
  ): ChatMessage['content'] {
    if (reasoning && reasoning.length > 0) {
      return [
        { type: 'thinking', thinking: reasoning },
        { type: 'text', text: content ?? '' },
      ];
    }
    return content ?? '';
  }

  private async readErrorBody(response: Response): Promise<GroqErrorBody | string | undefined> {
    try {
      return (await response.json()) as GroqErrorBody;
    } catch {
      try {
        return await response.text();
      } catch {
        return undefined;
      }
    }
  }

  private mapFinishReason(reason: string | null | undefined): FinishReason {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
