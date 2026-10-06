import type { Agent, AgentVersion } from '../../domain/entities.js';
import type { AgentCategory, AgentId, AgentStatus } from '../../domain/types.js';
import type { AgentRepositoryPort } from '../../application/ports/agent-repository.port.js';
import type { DatabasePool } from '../database/connection.js';

interface AgentRow {
  agent_id: string;
  name: string;
  description: string;
  category: string;
  status: string;
  latest_version?: string;
  created_at: Date;
  updated_at: Date;
}

interface AgentVersionRow {
  agent_id: string;
  version: string;
  system_instructions: string;
  default_model: string;
  default_effort: string;
  allowed_tools: unknown;
  default_budget: unknown;
  policy: unknown;
  is_frozen: boolean;
  published_at: Date;
}

export class PostgresAgentRepository implements AgentRepositoryPort {
  constructor(private readonly db: DatabasePool) {}

  public async getAgent(agentId: AgentId): Promise<Agent | null> {
    const result = await this.db.query<AgentRow>(
      `SELECT a.agent_id, a.name, a.description, a.category, a.status, a.created_at, a.updated_at,
              COALESCE(
                (SELECT version FROM oicunt_agents.agent_versions v WHERE v.agent_id = a.agent_id ORDER BY v.published_at DESC LIMIT 1),
                '1.0.0'
              ) as latest_version
       FROM oicunt_agents.agents a
       WHERE a.agent_id = $1`,
      [agentId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapAgentRow(result.rows[0]!);
  }

  public async listAgents(category?: AgentCategory): Promise<readonly Agent[]> {
    let query = `
      SELECT a.agent_id, a.name, a.description, a.category, a.status, a.created_at, a.updated_at,
             COALESCE(
               (SELECT version FROM oicunt_agents.agent_versions v WHERE v.agent_id = a.agent_id ORDER BY v.published_at DESC LIMIT 1),
               '1.0.0'
             ) as latest_version
      FROM oicunt_agents.agents a
    `;
    const params: unknown[] = [];

    if (category) {
      query += ' WHERE a.category = $1';
      params.push(category);
    }

    query += ' ORDER BY a.name ASC';

    const result = await this.db.query<AgentRow>(query, params);
    return result.rows.map((row) => this.mapAgentRow(row));
  }

  public async saveAgent(agent: Agent): Promise<void> {
    await this.db.query(
      `INSERT INTO oicunt_agents.agents (agent_id, name, description, category, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (agent_id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         category = EXCLUDED.category,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [
        agent.agentId,
        agent.name,
        agent.description,
        agent.category,
        agent.status,
        agent.createdAt,
        agent.updatedAt,
      ],
    );
  }

  public async getAgentVersion(agentId: AgentId, version: string): Promise<AgentVersion | null> {
    const result = await this.db.query<AgentVersionRow>(
      `SELECT agent_id, version, system_instructions, default_model, default_effort,
              allowed_tools, default_budget, policy, is_frozen, published_at
       FROM oicunt_agents.agent_versions
       WHERE agent_id = $1 AND version = $2`,
      [agentId, version],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapVersionRow(result.rows[0]!);
  }

  public async saveAgentVersion(version: AgentVersion): Promise<void> {
    await this.db.query(
      `INSERT INTO oicunt_agents.agent_versions
         (agent_id, version, system_instructions, default_model, default_effort, allowed_tools, default_budget, policy, is_frozen, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (agent_id, version) DO UPDATE SET
         system_instructions = EXCLUDED.system_instructions,
         default_model = EXCLUDED.default_model,
         default_effort = EXCLUDED.default_effort,
         allowed_tools = EXCLUDED.allowed_tools,
         default_budget = EXCLUDED.default_budget,
         policy = EXCLUDED.policy,
         is_frozen = EXCLUDED.is_frozen,
         published_at = EXCLUDED.published_at`,
      [
        version.agentId,
        version.version,
        version.systemInstructions,
        version.defaultModel,
        version.defaultEffort,
        JSON.stringify(version.allowedTools),
        JSON.stringify(version.defaultBudget),
        JSON.stringify(version.policy),
        version.isFrozen,
        version.publishedAt,
      ],
    );
  }

  private mapAgentRow(row: AgentRow): Agent {
    return {
      agentId: row.agent_id as AgentId,
      name: row.name,
      description: row.description,
      category: row.category as AgentCategory,
      status: row.status as AgentStatus,
      latestVersion: row.latest_version ?? '1.0.0',
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private mapVersionRow(row: AgentVersionRow): AgentVersion {
    const allowedTools =
      typeof row.allowed_tools === 'string'
        ? JSON.parse(row.allowed_tools)
        : (row.allowed_tools as readonly string[]);
    const defaultBudget =
      typeof row.default_budget === 'string'
        ? JSON.parse(row.default_budget)
        : (row.default_budget as any);
    const policy = typeof row.policy === 'string' ? JSON.parse(row.policy) : (row.policy as any);

    return {
      agentId: row.agent_id as AgentId,
      version: row.version,
      systemInstructions: row.system_instructions,
      defaultModel: row.default_model as any,
      defaultEffort: row.default_effort as any,
      allowedTools,
      defaultBudget,
      policy,
      isFrozen: row.is_frozen,
      publishedAt: row.published_at.toISOString(),
    };
  }
}
