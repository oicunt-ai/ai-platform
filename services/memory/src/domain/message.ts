import type { MessageContentPart, MessageRole } from '@oicunt-ai/ai-types';

export interface ConversationMessage {
  /** Unique message identifier (e.g. 'msg_01HZX9M2...') */
  readonly id: string;

  /** Enclosing conversation identifier */
  readonly conversationId: string;

  /** Platform tenant scope */
  readonly tenantId: string;

  /** Turn identifier grouping corresponding user/assistant exchange */
  readonly turnId: string;

  /**
   * Strictly increasing and unique sequence number within this conversation.
   * Invariant: Strictly increasing and unique per conversation; gaps are allowed while ordering remains deterministic.
   */
  readonly sequenceNumber: number;

  /** Canonical participant role */
  readonly role: MessageRole;

  /**
   * Message content: plain text string or polymorphic structured parts
   * (TextPart, ImagePart, ToolCallPart, ToolResultPart, ThinkingPart).
   */
  readonly content: string | readonly MessageContentPart[];

  /** Optional author or tool name */
  readonly name: string | null;

  /** Estimated tokens consumed by this message */
  readonly tokenEstimate: number;

  /** Execution metadata (model, completionId, finishReason, usage, latencyMs) */
  readonly metadata: Record<string, unknown>;

  /** Creation timestamp */
  readonly createdAt: string;
}
