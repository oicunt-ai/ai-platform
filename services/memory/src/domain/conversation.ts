import type { ConversationStatus } from './types.js';

export interface Conversation {
  /** Canonical conversation identifier (e.g. 'conv_01HZX8K9...') */
  readonly id: string;

  /** Platform tenant scope (mandatory isolation boundary) */
  readonly tenantId: string;

  /** Authenticated user identifier */
  readonly userId: string;

  /** Optional human-readable conversation title */
  readonly title: string | null;

  /** Lifecycle state */
  readonly status: ConversationStatus;

  /** Extensible caller metadata (e.g. product source, client tags) */
  readonly metadata: Record<string, unknown>;

  /** Total number of messages stored in the conversation */
  readonly messageCount: number;

  /** Cumulative estimated token count across all active messages */
  readonly totalTokensEstimate: number;

  /** Timestamp when conversation was initialized */
  readonly createdAt: string;

  /** Timestamp of most recent update or message append */
  readonly updatedAt: string;

  /** Timestamp of the most recent message appended */
  readonly lastMessageAt: string | null;

  /** Expiration timestamp for automatic retention purging (null if indefinite) */
  readonly retentionExpiresAt: string | null;

  /** Soft-delete timestamp (null if active or archived) */
  readonly deletedAt: string | null;
}
