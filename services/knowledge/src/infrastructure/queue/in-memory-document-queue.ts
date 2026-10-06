import type {
  DocumentProcessingQueuePort,
  DocumentProcessJob,
} from '../../application/ports/document-processing-queue.port.js';

export type JobHandler = (job: DocumentProcessJob) => Promise<void>;

export class InMemoryDocumentProcessingQueue implements DocumentProcessingQueuePort {
  private readonly jobs: DocumentProcessJob[] = [];
  private handler: JobHandler | null = null;
  private autoProcess = true;

  constructor(options?: { readonly autoProcess?: boolean | undefined }) {
    if (options?.autoProcess !== undefined) {
      this.autoProcess = options.autoProcess;
    }
  }

  public registerWorker(handler: JobHandler): void {
    this.handler = handler;
  }

  public async publishJob(job: DocumentProcessJob): Promise<void> {
    this.jobs.push(job);
    if (this.autoProcess && this.handler) {
      // Process in next event loop tick to simulate asynchronous job queue
      setImmediate(() => {
        void this.handler!(job).catch(() => {});
      });
    }
  }

  public getPublishedJobs(): readonly DocumentProcessJob[] {
    return Object.freeze([...this.jobs]);
  }

  public clear(): void {
    this.jobs.length = 0;
  }

  public async checkHealth(): Promise<boolean> {
    return true;
  }
}
