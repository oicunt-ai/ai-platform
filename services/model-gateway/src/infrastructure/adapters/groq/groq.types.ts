/**
 * Groq OpenAI-compatible wire types for the Chat Completions API.
 * Only the subset consumed by the adapter is modelled; unknown fields are ignored.
 */
export interface GroqChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  readonly content: string | readonly GroqContentPart[] | null;
  readonly name?: string | undefined;
  readonly tool_call_id?: string | undefined;
  readonly tool_calls?: readonly GroqToolCall[] | undefined;
}

export interface GroqContentPart {
  readonly type: 'text' | 'image_url';
  readonly text?: string | undefined;
  readonly image_url?: { readonly url: string } | undefined;
}

export interface GroqToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface GroqChatCompletionsRequest {
  readonly model: string;
  readonly messages: readonly GroqChatMessage[];
  readonly temperature?: number | undefined;
  readonly top_p?: number | undefined;
  readonly max_tokens?: number | undefined;
  readonly max_completion_tokens?: number | undefined;
  readonly stop?: readonly string[] | undefined;
  readonly stream?: boolean | undefined;
  readonly stream_options?: { readonly include_usage: boolean } | undefined;
  readonly reasoning_effort?: string | undefined;
  readonly seed?: number | undefined;
  readonly presence_penalty?: number | undefined;
  readonly frequency_penalty?: number | undefined;
  readonly user?: string | undefined;
}

export interface GroqUsage {
  readonly prompt_tokens?: number | undefined;
  readonly completion_tokens?: number | undefined;
  readonly total_tokens?: number | undefined;
  readonly completion_tokens_details?:
    | {
        readonly reasoning_tokens?: number | undefined;
      }
    | null
    | undefined;
  readonly prompt_tokens_details?:
    | {
        readonly cached_tokens?: number | undefined;
      }
    | null
    | undefined;
}

export interface GroqChatChoice {
  readonly index: number;
  readonly message?:
    | {
        readonly role?: string | undefined;
        readonly content?: string | null | undefined;
        readonly reasoning?: string | null | undefined;
        readonly tool_calls?: readonly GroqToolCall[] | undefined;
      }
    | undefined;
  readonly finish_reason?: string | null | undefined;
}

export interface GroqChatCompletionsResponse {
  readonly id?: string | undefined;
  readonly choices?: readonly GroqChatChoice[] | undefined;
  readonly usage?: GroqUsage | null | undefined;
}

export interface GroqStreamDelta {
  readonly content?: string | null | undefined;
  readonly reasoning?: string | null | undefined;
  readonly role?: string | undefined;
  readonly tool_calls?:
    | readonly {
        readonly index?: number | undefined;
        readonly id?: string | undefined;
        readonly function?:
          | { readonly name?: string | undefined; readonly arguments?: string | undefined }
          | undefined;
      }[]
    | undefined;
}

export interface GroqStreamChoice {
  readonly index: number;
  readonly delta?: GroqStreamDelta | undefined;
  readonly finish_reason?: string | null | undefined;
}

export interface GroqChatChunk {
  readonly choices?: readonly GroqStreamChoice[] | undefined;
  readonly usage?: GroqUsage | null | undefined;
  readonly error?:
    | {
        readonly message?: string | undefined;
        readonly type?: string | undefined;
        readonly code?: string | undefined;
      }
    | undefined;
}

export interface GroqErrorBody {
  readonly error?:
    | {
        readonly message?: string | undefined;
        readonly type?: string | undefined;
        readonly code?: string | undefined;
      }
    | undefined;
}
