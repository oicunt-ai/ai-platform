import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { VectorStorePort } from '../ports/vector-store.port.js';
import type { EmbeddingServicePort } from '../ports/embedding-service.port.js';
import type { RetrievalInputDto, RetrievalResponseDto } from '../dtos/retrieval.dto.js';
import { toRetrievalResponseDto } from '../dtos/retrieval.dto.js';
import type { RetrievedChunk } from '../../domain/index.js';
import {
  CollectionNotFoundError,
  DEFAULT_RETRIEVAL_TOP_K,
  validateRetrievalQuery,
  buildRetrievalResult,
  buildChunkProvenance,
  DeadlineExceededError,
  RequestCancelledError,
} from '../../domain/index.js';

export interface RetrieveContextCallContext {
  readonly tenantId: string;
  readonly correlationId?: string | undefined;
  readonly deadlineMs?: number | undefined;
}

export class RetrieveContextUseCase {
  constructor(
    private readonly repository: DocumentRepositoryPort,
    private readonly vectorStore: VectorStorePort,
    private readonly embeddingService: EmbeddingServicePort,
  ) {}

  public async execute(
    context: RetrieveContextCallContext,
    dto: RetrievalInputDto,
    signal?: AbortSignal,
  ): Promise<RetrievalResponseDto> {
    const startTime = Date.now();

    // Check cancellation
    if (signal?.aborted) {
      throw new RequestCancelledError('Retrieval request cancelled by caller');
    }

    // Check deadline
    if (context.deadlineMs && Date.now() >= context.deadlineMs) {
      throw new DeadlineExceededError('Deadline exceeded before retrieval started');
    }

    const topK = dto.topK ?? DEFAULT_RETRIEVAL_TOP_K;
    validateRetrievalQuery({
      query: dto.query,
      collectionIds: dto.collectionIds,
      topK,
      minScore: dto.minScore,
      metadataFilters: dto.metadataFilters,
    });

    // Verify tenant ownership of all collections
    const collections = await Promise.all(
      dto.collectionIds.map(async (colId) => {
        const col = await this.repository.getCollection(context.tenantId, colId);
        if (!col) {
          throw new CollectionNotFoundError(colId);
        }
        return col;
      }),
    );

    const primaryCollection = collections[0]!;

    // Generate query embedding
    const embeddingResponse = await this.embeddingService.generateEmbeddings(
      {
        texts: [dto.query],
        modelId: primaryCollection.embeddingConfig.modelId,
        dimensions: primaryCollection.embeddingConfig.dimensions,
        tenantId: context.tenantId,
        correlationId: context.correlationId,
      },
      signal,
    );

    const queryVector = embeddingResponse.embeddings[0];
    if (!queryVector) {
      throw new Error('Embedding service failed to produce query vector');
    }

    // Check deadline after embedding
    if (context.deadlineMs && Date.now() >= context.deadlineMs) {
      throw new DeadlineExceededError('Deadline exceeded during embedding generation');
    }

    // Vector similarity search
    const vectorResults = await this.vectorStore.searchVectors(
      {
        tenantId: context.tenantId,
        collectionIds: dto.collectionIds,
        vector: queryVector,
        topK,
        minScore: dto.minScore,
        filter: dto.metadataFilters,
      },
      signal,
    );

    if (vectorResults.length === 0) {
      const latencyMs = Date.now() - startTime;
      return toRetrievalResponseDto(
        buildRetrievalResult({
          query: dto.query,
          chunks: [],
          totalChunksEvaluated: 0,
          latencyMs,
        }),
      );
    }

    const chunkIds = vectorResults.map((r) => r.id);
    const chunks = await this.repository.getChunksByIds(context.tenantId, chunkIds);
    const chunkMap = new Map(chunks.map((c) => [c.id, c]));

    interface CachedDocInfo {
      readonly status: string;
      readonly title: string;
      readonly sourceUri?: string | undefined;
    }

    // Cache document statuses to enforce READY-ONLY retrieval
    const documentCache = new Map<string, CachedDocInfo>();

    const retrievedChunks: RetrievedChunk[] = [];
    for (const vr of vectorResults) {
      const chunk = chunkMap.get(vr.id);
      if (!chunk) {
        continue;
      }

      // Check document status
      let docInfo = documentCache.get(chunk.documentId);
      if (!docInfo) {
        const doc = await this.repository.getDocument(context.tenantId, chunk.documentId);
        if (!doc) {
          continue;
        }
        const loaded: CachedDocInfo = {
          status: doc.status,
          title: doc.title,
          sourceUri: doc.sourceUri,
        };
        documentCache.set(chunk.documentId, loaded);
        docInfo = loaded;
      }

      // CRITICAL INVARIANT: Only READY documents are retrievable.
      // Documents in 'created', 'queued', 'processing', 'failed', or 'deleted' must NEVER be retrieved.
      if (docInfo.status !== 'ready') {
        continue;
      }

      retrievedChunks.push({
        id: chunk.id,
        text: chunk.text,
        score: vr.score,
        tokenEstimate: chunk.tokenEstimate,
        provenance: buildChunkProvenance({
          documentId: chunk.documentId,
          collectionId: chunk.collectionId,
          documentTitle: docInfo.title,
          chunkIndex: chunk.chunkIndex,
          sourceUri: docInfo.sourceUri,
          metadata: chunk.metadata,
        }),
      });
    }

    const latencyMs = Date.now() - startTime;
    return toRetrievalResponseDto(
      buildRetrievalResult({
        query: dto.query,
        chunks: retrievedChunks,
        totalChunksEvaluated: vectorResults.length,
        latencyMs,
      }),
    );
  }
}
