/**
 * Anthropic Messages API v1 wire contract definitions.
 * Isolated strictly within the Model Gateway provider boundary.
 */

export interface AnthropicTextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface AnthropicImageSource {
  readonly type: 'base64';
  readonly media_type: string;
  readonly data: string;
}

export interface AnthropicImageBlock {
  readonly type: 'image';
  readonly source: AnthropicImageSource;
}

export interface AnthropicToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}

export interface AnthropicThinkingBlock {
  readonly type: 'thinking';
  readonly thinking: string;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock;

export interface AnthropicMessageParam {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly AnthropicContentBlock[];
}

export interface AnthropicToolParam {
  readonly name: string;
  readonly description?: string;
  readonly input_schema: Record<string, unknown>;
}

export interface AnthropicMessagesRequest {
  readonly model: string;
  readonly messages: readonly AnthropicMessageParam[];
  readonly max_tokens: number;
  readonly system?: string | readonly AnthropicTextBlock[] | undefined;
  readonly temperature?: number | undefined;
  readonly top_p?: number | undefined;
  readonly top_k?: number | undefined;
  readonly stop_sequences?: readonly string[] | undefined;
  readonly tools?: readonly AnthropicToolParam[] | undefined;
  readonly stream?: boolean | undefined;
}

export interface AnthropicUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number | undefined;
  readonly cache_read_input_tokens?: number | undefined;
}

export type AnthropicStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | string;

export interface AnthropicMessagesResponse {
  readonly id: string;
  readonly type: 'message';
  readonly role: 'assistant';
  readonly content: readonly AnthropicContentBlock[];
  readonly model: string;
  readonly stop_reason: AnthropicStopReason | null;
  readonly stop_sequence: string | null;
  readonly usage: AnthropicUsage;
}

export interface AnthropicErrorResponse {
  readonly type: 'error';
  readonly error: {
    readonly type: string;
    readonly message: string;
  };
}
