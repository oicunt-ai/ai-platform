export interface AgentKnowledgeRetrievalRequest {
  readonly query: string;
  readonly collectionIds: readonly string[];
  readonly topK?: number | undefined;
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface AgentKnowledgeChunk {
  readonly chunkId: string;
  readonly documentId: string;
  readonly collectionId: string;
  readonly content: string;
  readonly score: number;
}

export interface KnowledgeClientPort {
  retrieve(
    request: AgentKnowledgeRetrievalRequest,
    signal?: AbortSignal | undefined,
  ): Promise<readonly AgentKnowledgeChunk[]>;
}
