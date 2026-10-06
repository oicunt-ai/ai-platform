export interface EmbeddingRequest {
  readonly texts: readonly string[];
  readonly modelId: string;
  readonly dimensions?: number | undefined;
  readonly tenantId: string;
  readonly correlationId?: string | undefined;
}

export interface EmbeddingResponse {
  readonly embeddings: readonly (readonly number[])[];
  readonly modelId: string;
  readonly dimensions: number;
  readonly usage: { readonly totalTokens: number };
}

export interface EmbeddingServicePort {
  generateEmbeddings(request: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResponse>;
  checkHealth(signal?: AbortSignal): Promise<boolean>;
}
