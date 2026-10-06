import type {
  AgentKnowledgeChunk,
  AgentKnowledgeRetrievalRequest,
  KnowledgeClientPort,
} from '../../application/ports/knowledge-client.port.js';
import { KnowledgeRetrievalFailureError, RequestCancelledError } from '../../domain/errors.js';

export interface HttpKnowledgeClientOptions {
  readonly baseUrl: string;
  readonly internalToken?: string | undefined;
}

export class HttpKnowledgeClient implements KnowledgeClientPort {
  private readonly baseUrl: string;
  private readonly internalToken?: string | undefined;

  constructor(options: HttpKnowledgeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalToken = options.internalToken;
  }

  public async retrieve(
    request: AgentKnowledgeRetrievalRequest,
    signal?: AbortSignal | undefined,
  ): Promise<readonly AgentKnowledgeChunk[]> {
    const url = `${this.baseUrl}/internal/v1/knowledge/retrieve`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant-ID': request.tenantId,
      'X-User-ID': request.actorId,
      'X-Actor-ID': request.actorId,
      'X-Correlation-ID': request.correlationId,
    };

    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${this.internalToken}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: request.query,
          collectionIds: request.collectionIds,
          topK: request.topK ?? 5,
        }),
        ...(signal ? { signal } : {}),
      });

      if (response.ok) {
        const body = (await response.json()) as any;
        const data = body.data ?? body;
        const chunks = (data.chunks ?? data.results ?? data) as any[];
        return chunks.map((c: any) => ({
          chunkId: c.chunkId ?? c.id,
          documentId: c.documentId,
          collectionId: c.collectionId,
          content: c.content ?? c.text ?? '',
          score: c.score ?? 1.0,
        }));
      }

      let errorText = '';
      try {
        const errJson = (await response.json()) as any;
        errorText = errJson.error?.message ?? errJson.message ?? JSON.stringify(errJson);
      } catch {
        errorText = await response.text();
      }

      throw new KnowledgeRetrievalFailureError(
        `Knowledge Service returned status ${response.status}: ${errorText}`,
        { status: response.status, body: errorText },
      );
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError('Knowledge retrieval was cancelled');
      }
      if (err instanceof KnowledgeRetrievalFailureError) {
        throw err;
      }
      throw new KnowledgeRetrievalFailureError(
        `Failed to reach Knowledge Service: ${(err as Error).message}`,
        { originalError: String(err) },
      );
    }
  }
}
