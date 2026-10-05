import type { ChatMessage } from '@oicunt-ai/ai-types';

export interface RetrievedDocumentChunk {
  readonly id: string;
  readonly documentId: string;
  readonly content: string;
  readonly score: number;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface RetrievalQuery {
  readonly query: string;
  readonly topK?: number | undefined;
  readonly filter?: Record<string, unknown> | undefined;
}

/**
 * Future extension port for semantic knowledge retrieval and RAG (services/knowledge).
 */
export interface KnowledgeRetrievalPort {
  /**
   * Retrieves relevant grounded knowledge chunks to augment conversational context.
   */
  retrieveContext(
    query: RetrievalQuery,
    messages: readonly ChatMessage[],
  ): Promise<readonly RetrievedDocumentChunk[]>;
}
