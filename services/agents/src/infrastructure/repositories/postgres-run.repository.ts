import type { TokenUsage } from '@oicunt-ai/model-types';
import type { AgentCheckpoint, AgentRun, AgentStep } from '../../domain/entities.js';
import type {
  AgentId,
  AgentRunId,
  AgentRunStatus,
  AgentStepId,
  AgentStepStatus,
  AgentStepType,
  TerminationReason,
} from '../../domain/types.js';
import type { RunRepositoryPort } from '../../application/ports/run-repository.port.js';
import type { DatabasePool } from '../database/connection.js';

interface RunRow {
  run_id: string;
  agent_id: string;
  agent_version: string;
  tenant_id: string;
  actor_id: string;
  correlation_id: string;
  conversation_id: string | null;
  status: string;
  budget: unknown;
  cumulative_usage: unknown;
  final_output: string | null;
  termination_reason: string | null;
  current_step_number: number;
  worker_lease_id: string | null;
  lease_expires_at: Date | null;
  started_at: Date;
  completed_at: Date | null;
}

interface StepRow {
  step_id: string;
  run_id: string;
  step_number: number;
  step_type: string;
  status: string;
  decision_summary: string | null;
  structured_decision: unknown;
  action: unknown;
  observation: unknown;
  step_usage: unknown;
  duration_ms: number;
  started_at: Date;
  completed_at: Date | null;
}

interface CheckpointRow {
  checkpoint_id: string;
  run_id: string;
  step_number: number;
  state_payload: unknown;
  pending_challenge: unknown;
  created_at: Date;
}

export class PostgresRunRepository implements RunRepositoryPort {
  constructor(private readonly db: DatabasePool) {}

  public async createRun(run: AgentRun): Promise<void> {
    await this.db.query(
      `INSERT INTO oicunt_agents.agent_runs
         (run_id, agent_id, agent_version, tenant_id, actor_id, correlation_id, conversation_id, status, budget, cumulative_usage, current_step_number, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        run.runId,
        run.agentId,
        run.agentVersion,
        run.tenantId,
        run.actorId,
        run.correlationId,
        run.conversationId ?? null,
        run.status,
        JSON.stringify(run.budget),
        JSON.stringify(run.cumulativeUsage),
        run.currentStepNumber,
        run.startedAt,
      ],
    );
  }

  public async getRun(tenantId: string, runId: AgentRunId): Promise<AgentRun | null> {
    const result = await this.db.query<RunRow>(
      `SELECT * FROM oicunt_agents.agent_runs WHERE tenant_id = $1 AND run_id = $2`,
      [tenantId, runId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRunRow(result.rows[0]!);
  }

  public async updateRunStatus(
    tenantId: string,
    runId: AgentRunId,
    status: AgentRunStatus,
    reason?: TerminationReason | undefined,
    finalOutput?: string | undefined,
  ): Promise<void> {
    await this.db.query(
      `UPDATE oicunt_agents.agent_runs
       SET status = $1,
           termination_reason = COALESCE($2, termination_reason),
           final_output = COALESCE($3, final_output),
           completed_at = CASE
             WHEN $1 IN ('completed', 'failed', 'cancelled', 'timed_out') AND completed_at IS NULL THEN NOW()
             ELSE completed_at
           END
       WHERE tenant_id = $4 AND run_id = $5`,
      [status, reason ?? null, finalOutput ?? null, tenantId, runId],
    );
  }

  public async updateRunProgress(
    tenantId: string,
    runId: AgentRunId,
    stepNumber: number,
    usage: TokenUsage,
  ): Promise<void> {
    await this.db.query(
      `UPDATE oicunt_agents.agent_runs
       SET current_step_number = $1,
           cumulative_usage = $2
       WHERE tenant_id = $3 AND run_id = $4`,
      [stepNumber, JSON.stringify(usage), tenantId, runId],
    );
  }

  public async appendStep(step: AgentStep): Promise<void> {
    await this.db.query(
      `INSERT INTO oicunt_agents.agent_steps
         (step_id, run_id, step_number, step_type, status, decision_summary, structured_decision, action, observation, step_usage, duration_ms, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (run_id, step_number) DO UPDATE SET
         status = EXCLUDED.status,
         decision_summary = EXCLUDED.decision_summary,
         structured_decision = EXCLUDED.structured_decision,
         action = EXCLUDED.action,
         observation = EXCLUDED.observation,
         step_usage = EXCLUDED.step_usage,
         duration_ms = EXCLUDED.duration_ms,
         completed_at = EXCLUDED.completed_at`,
      [
        step.stepId,
        step.runId,
        step.stepNumber,
        step.type,
        step.status,
        step.decisionSummary ?? null,
        step.structuredDecision ? JSON.stringify(step.structuredDecision) : null,
        step.action ? JSON.stringify(step.action) : null,
        step.observation ? JSON.stringify(step.observation) : null,
        step.stepUsage ? JSON.stringify(step.stepUsage) : null,
        step.durationMs,
        step.startedAt,
        step.completedAt ?? null,
      ],
    );
  }

  public async getSteps(runId: AgentRunId): Promise<readonly AgentStep[]> {
    const result = await this.db.query<StepRow>(
      `SELECT * FROM oicunt_agents.agent_steps WHERE run_id = $1 ORDER BY step_number ASC`,
      [runId],
    );

    return result.rows.map((row) => this.mapStepRow(row));
  }

  public async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> {
    await this.db.query(
      `INSERT INTO oicunt_agents.agent_checkpoints
         (checkpoint_id, run_id, step_number, state_payload, pending_challenge, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (run_id, step_number) DO UPDATE SET
         state_payload = EXCLUDED.state_payload,
         pending_challenge = EXCLUDED.pending_challenge`,
      [
        checkpoint.checkpointId,
        checkpoint.runId,
        checkpoint.stepNumber,
        JSON.stringify(checkpoint.statePayload),
        checkpoint.pendingChallenge ? JSON.stringify(checkpoint.pendingChallenge) : null,
        checkpoint.createdAt,
      ],
    );
  }

  public async getLatestCheckpoint(runId: AgentRunId): Promise<AgentCheckpoint | null> {
    const result = await this.db.query<CheckpointRow>(
      `SELECT * FROM oicunt_agents.agent_checkpoints WHERE run_id = $1 ORDER BY step_number DESC LIMIT 1`,
      [runId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapCheckpointRow(result.rows[0]!);
  }

  public async acquireLease(
    runId: AgentRunId,
    workerId: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE oicunt_agents.agent_runs
       SET worker_lease_id = $1,
           lease_expires_at = NOW() + ($2 || ' milliseconds')::interval
       WHERE run_id = $3
         AND (worker_lease_id IS NULL OR lease_expires_at < NOW() OR worker_lease_id = $1)
       RETURNING run_id`,
      [workerId, leaseDurationMs.toString(), runId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async renewLease(
    runId: AgentRunId,
    workerId: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE oicunt_agents.agent_runs
       SET lease_expires_at = NOW() + ($1 || ' milliseconds')::interval
       WHERE run_id = $2 AND worker_lease_id = $3
       RETURNING run_id`,
      [leaseDurationMs.toString(), runId, workerId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async releaseLease(runId: AgentRunId, workerId: string): Promise<void> {
    await this.db.query(
      `UPDATE oicunt_agents.agent_runs
       SET worker_lease_id = NULL,
           lease_expires_at = NULL
       WHERE run_id = $1 AND worker_lease_id = $2`,
      [runId, workerId],
    );
  }

  private mapRunRow(row: RunRow): AgentRun {
    const budget = typeof row.budget === 'string' ? JSON.parse(row.budget) : (row.budget as any);
    const cumulativeUsage =
      typeof row.cumulative_usage === 'string'
        ? JSON.parse(row.cumulative_usage)
        : (row.cumulative_usage as any);

    return {
      runId: row.run_id as AgentRunId,
      agentId: row.agent_id as AgentId,
      agentVersion: row.agent_version,
      tenantId: row.tenant_id,
      actorId: row.actor_id,
      correlationId: row.correlation_id,
      conversationId: row.conversation_id ?? undefined,
      status: row.status as AgentRunStatus,
      budget,
      cumulativeUsage,
      finalOutput: row.final_output ?? undefined,
      terminationReason: (row.termination_reason as TerminationReason) ?? undefined,
      currentStepNumber: row.current_step_number,
      workerLeaseId: row.worker_lease_id ?? undefined,
      leaseExpiresAt: row.lease_expires_at ? row.lease_expires_at.toISOString() : undefined,
      startedAt: row.started_at.toISOString(),
      completedAt: row.completed_at ? row.completed_at.toISOString() : undefined,
    };
  }

  private mapStepRow(row: StepRow): AgentStep {
    const structuredDecision =
      typeof row.structured_decision === 'string'
        ? JSON.parse(row.structured_decision)
        : (row.structured_decision as any);
    const action = typeof row.action === 'string' ? JSON.parse(row.action) : (row.action as any);
    const observation =
      typeof row.observation === 'string' ? JSON.parse(row.observation) : (row.observation as any);
    const stepUsage =
      typeof row.step_usage === 'string' ? JSON.parse(row.step_usage) : (row.step_usage as any);

    return {
      stepId: row.step_id as AgentStepId,
      runId: row.run_id as AgentRunId,
      stepNumber: row.step_number,
      type: row.step_type as AgentStepType,
      status: row.status as AgentStepStatus,
      decisionSummary: row.decision_summary ?? undefined,
      structuredDecision: structuredDecision ?? undefined,
      action: action ?? undefined,
      observation: observation ?? undefined,
      stepUsage: stepUsage ?? undefined,
      durationMs: row.duration_ms,
      startedAt: row.started_at.toISOString(),
      completedAt: row.completed_at ? row.completed_at.toISOString() : undefined,
    };
  }

  private mapCheckpointRow(row: CheckpointRow): AgentCheckpoint {
    const statePayload =
      typeof row.state_payload === 'string'
        ? JSON.parse(row.state_payload)
        : (row.state_payload as any);
    const pendingChallenge =
      typeof row.pending_challenge === 'string'
        ? JSON.parse(row.pending_challenge)
        : (row.pending_challenge as any);

    return {
      checkpointId: row.checkpoint_id,
      runId: row.run_id as AgentRunId,
      stepNumber: row.step_number,
      statePayload,
      pendingChallenge: pendingChallenge ?? undefined,
      createdAt: row.created_at.toISOString(),
    };
  }
}
