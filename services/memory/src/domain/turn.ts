import type { ConversationMessage } from './message.js';

export interface ConversationTurn {
  readonly turnId: string;
  readonly conversationId: string;
  readonly tenantId: string;
  readonly messages: readonly ConversationMessage[];
  readonly createdAt: string;
}
