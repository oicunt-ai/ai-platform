import type { TokenUsage } from '@oicunt-ai/model-types';
import type { AgentCheckpoint, AgentRun, AgentStep } from '../../domain/entities.js';
import type { AgentRunId, AgentRunStatus, TerminationReason } from '../../domain/types.js';
import type { RunRepositoryPort } from '../../application/ports/run-repository.port.js';

interface LeaseRecord {
  workerId: string;
  expiresAt: number;
}

export class InMemoryRunRepository implements RunRepositoryPort {
  private readonly runs = new Map<AgentRunId, AgentRun>();
  private readonly steps = new Map<AgentRunId, AgentStep[]>();
  private readonly checkpoints = new Map<AgentRunId, AgentCheckpoint[]>();
  private readonly leases = new Map<AgentRunId, LeaseRecord>();

  public async createRun(run: AgentRun): Promise<void> {
    this.runs.set(run.runId, { ...run });
  }

  public async getRun(tenantId: string, runId: AgentRunId): Promise<AgentRun | null> {
    const run = this.runs.get(runId);
    if (!run || run.tenantId !== tenantId) {
      return null;
    }
    return { ...run };
  }

  public async updateRunStatus(
    tenantId: string,
    runId: AgentRunId,
    status: AgentRunStatus,
    reason?: TerminationReason | undefined,
    finalOutput?: string | undefined,
  ): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.tenantId !== tenantId) {
      return;
    }
    const isTerminal =
      status === 'completed' ||
      status === 'failed' ||
      status === 'cancelled' ||
      status === 'timed_out';
    this.runs.set(runId, {
      ...run,
      status,
      terminationReason: reason ?? run.terminationReason,
      finalOutput: finalOutput ?? run.finalOutput,
      completedAt: isTerminal ? (run.completedAt ?? new Date().toISOString()) : run.completedAt,
    });
  }

  public async updateRunProgress(
    tenantId: string,
    runId: AgentRunId,
    stepNumber: number,
    usage: TokenUsage,
  ): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.tenantId !== tenantId) {
      return;
    }
    this.runs.set(runId, {
      ...run,
      currentStepNumber: stepNumber,
      cumulativeUsage: { ...usage },
    });
  }

  public async appendStep(step: AgentStep): Promise<void> {
    const existing = this.steps.get(step.runId) ?? [];
    // If step with same stepNumber exists, update it, else append
    const idx = existing.findIndex((s) => s.stepNumber === step.stepNumber);
    if (idx >= 0) {
      existing[idx] = { ...step };
    } else {
      existing.push({ ...step });
    }
    existing.sort((a, b) => a.stepNumber - b.stepNumber);
    this.steps.set(step.runId, existing);
  }

  public async getSteps(runId: AgentRunId): Promise<readonly AgentStep[]> {
    const existing = this.steps.get(runId) ?? [];
    return [...existing];
  }

  public async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> {
    const existing = this.checkpoints.get(checkpoint.runId) ?? [];
    const idx = existing.findIndex((c) => c.stepNumber === checkpoint.stepNumber);
    if (idx >= 0) {
      existing[idx] = { ...checkpoint };
    } else {
      existing.push({ ...checkpoint });
    }
    existing.sort((a, b) => a.stepNumber - b.stepNumber);
    this.checkpoints.set(checkpoint.runId, existing);
  }

  public async getLatestCheckpoint(runId: AgentRunId): Promise<AgentCheckpoint | null> {
    const existing = this.checkpoints.get(runId) ?? [];
    if (existing.length === 0) {
      return null;
    }
    return { ...existing[existing.length - 1]! };
  }

  public async acquireLease(
    runId: AgentRunId,
    workerId: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    const currentLease = this.leases.get(runId);
    if (currentLease && currentLease.expiresAt > now && currentLease.workerId !== workerId) {
      return false;
    }
    this.leases.set(runId, {
      workerId,
      expiresAt: now + leaseDurationMs,
    });
    return true;
  }

  public async renewLease(
    runId: AgentRunId,
    workerId: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    const currentLease = this.leases.get(runId);
    if (!currentLease || currentLease.workerId !== workerId) {
      return false;
    }
    this.leases.set(runId, {
      workerId,
      expiresAt: Date.now() + leaseDurationMs,
    });
    return true;
  }

  public async releaseLease(runId: AgentRunId, workerId: string): Promise<void> {
    const currentLease = this.leases.get(runId);
    if (currentLease && currentLease.workerId === workerId) {
      this.leases.delete(runId);
    }
  }
}
