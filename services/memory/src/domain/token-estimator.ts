import type { MessageContentPart } from '@oicunt-ai/ai-types';

/**
 * Heuristic token estimator complying with Section 3.6 of the contract:
 * - Uses bounded character heuristics (~4 characters per token).
 * - Incorporates structural overhead for multi-modal parts and tool calls.
 * - Imports zero third-party or provider tokenizers.
 */
export function estimateContentTokens(content: string | readonly MessageContentPart[]): number {
  if (typeof content === 'string') {
    if (content.length === 0) {
      return 0;
    }
    return Math.max(1, Math.ceil(content.length / 4));
  }

  if (!Array.isArray(content) || content.length === 0) {
    return 0;
  }

  let total = 0;
  for (const part of content) {
    switch (part.type) {
      case 'text': {
        total += Math.max(1, Math.ceil(part.text.length / 4));
        break;
      }
      case 'image': {
        // High/low resolution heuristic average: ~85 tokens base metadata overhead
        total += 85;
        break;
      }
      case 'tool_call': {
        const argsStr = JSON.stringify(part.arguments ?? {});
        total += 10 + Math.ceil((part.name.length + argsStr.length) / 4);
        break;
      }
      case 'tool_result': {
        const contentStr =
          typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? '');
        total += 10 + Math.ceil((part.name.length + contentStr.length) / 4);
        break;
      }
      case 'thinking': {
        total += Math.max(1, Math.ceil(part.thinking.length / 4));
        break;
      }
      default: {
        total += 1;
        break;
      }
    }
  }

  return Math.max(1, total);
}
