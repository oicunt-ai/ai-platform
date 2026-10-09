import type { ChatMessage, MessageContentPart } from '@oicunt-ai/ai-types';

/**
 * Provider-neutral bounded preflight context window estimator.
 *
 * Adheres strictly to the AI Orchestrator contract:
 * - Employs lightweight, provider-neutral heuristics (~4 chars/token).
 * - NEVER imports provider-specific tokenizers or vendor SDKs.
 * - Does not leak provider-specific quirks or internals.
 * - Leaves authoritative runtime enforcement to the Model Gateway.
 */
export class ContextWindowEstimator {
  private static readonly CHARS_PER_TOKEN = 4;
  private static readonly TOKENS_PER_MESSAGE_FRAME = 4;
  private static readonly TOKENS_PER_IMAGE = 1000;
  private static readonly TOKENS_PER_TOOL_FRAME = 20;

  /**
   * Estimates the total token count of a sequence of ChatMessages.
   */
  public static estimateMessagesTokens(messages: readonly ChatMessage[]): number {
    let totalTokens = 0;

    for (const msg of messages) {
      totalTokens += this.TOKENS_PER_MESSAGE_FRAME;

      if (typeof msg.content === 'string') {
        totalTokens += Math.ceil(msg.content.length / this.CHARS_PER_TOKEN);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as readonly MessageContentPart[]) {
          totalTokens += this.estimatePartTokens(part);
        }
      }

      if (msg.name) {
        totalTokens += Math.ceil(msg.name.length / this.CHARS_PER_TOKEN);
      }
    }

    return totalTokens;
  }

  private static estimatePartTokens(part: MessageContentPart): number {
    switch (part.type) {
      case 'text':
        return Math.ceil(part.text.length / this.CHARS_PER_TOKEN);
      case 'thinking':
        return Math.ceil(part.thinking.length / this.CHARS_PER_TOKEN);
      case 'image':
        return this.TOKENS_PER_IMAGE;
      case 'tool_call': {
        const argsStr = JSON.stringify(part.arguments ?? {});
        return (
          this.TOKENS_PER_TOOL_FRAME +
          Math.ceil(part.name.length / this.CHARS_PER_TOKEN) +
          Math.ceil(argsStr.length / this.CHARS_PER_TOKEN)
        );
      }
      case 'tool_result': {
        const contentStr =
          typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? {});
        return (
          this.TOKENS_PER_TOOL_FRAME +
          Math.ceil(part.name.length / this.CHARS_PER_TOKEN) +
          Math.ceil(contentStr.length / this.CHARS_PER_TOKEN)
        );
      }
      default:
        return 0;
    }
  }

  /**
   * Validates whether estimated prompt tokens + requested max tokens fits within the model limit.
   * Returns true if within limit, false if exceeded.
   */
  public static isWithinLimit(
    messages: readonly ChatMessage[],
    contextWindowTokens: number,
    requestedMaxTokens = 0,
  ): { valid: boolean; estimatedTokens: number } {
    const estimatedTokens = this.estimateMessagesTokens(messages) + requestedMaxTokens;
    return {
      valid: estimatedTokens <= contextWindowTokens,
      estimatedTokens,
    };
  }
}
