import type { AgentQueuePort, AgentRunJob } from '../../application/ports/agent-queue.port.js';

export type AgentJobHandler = (job: AgentRunJob) => Promise<void>;

export class InMemoryAgentQueue implements AgentQueuePort {
  private readonly jobs: AgentRunJob[] = [];
  private handler: AgentJobHandler | null = null;
  private autoProcess = true;

  constructor(options?: { readonly autoProcess?: boolean | undefined }) {
    if (options?.autoProcess !== undefined) {
      this.autoProcess = options.autoProcess;
    }
  }

  public registerWorker(handler: AgentJobHandler): void {
    this.handler = handler;
  }

  public async publishRunJob(job: AgentRunJob): Promise<void> {
    this.jobs.push(job);
    if (this.autoProcess && this.handler) {
      setImmediate(() => {
        void this.handler!(job).catch(() => {});
      });
    }
  }

  public getPublishedJobs(): readonly AgentRunJob[] {
    return Object.freeze([...this.jobs]);
  }

  public clear(): void {
    this.jobs.length = 0;
  }

  public async checkHealth(): Promise<boolean> {
    return true;
  }
}
