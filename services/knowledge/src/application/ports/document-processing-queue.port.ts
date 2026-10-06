export interface DocumentProcessJob {
  readonly eventId: string;
  readonly documentId: string;
  readonly collectionId: string;
  readonly tenantId: string;
  readonly objectKey: string;
  readonly sourceUri?: string | undefined;
  readonly mimeType: string;
  readonly correlationId: string;
  readonly timestamp: string;
  readonly attemptNumber: number;
}

export interface DocumentProcessingQueuePort {
  publishJob(job: DocumentProcessJob): Promise<void>;
  registerWorker?(handler: (job: DocumentProcessJob) => Promise<void>): void;
  checkHealth(signal?: AbortSignal): Promise<boolean>;
}
