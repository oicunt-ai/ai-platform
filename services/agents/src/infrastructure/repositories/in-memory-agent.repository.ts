import type { Agent, AgentVersion } from '../../domain/entities.js';
import { BUILT_IN_AGENTS } from '../../domain/built-in-agents.js';
import type { AgentCategory, AgentId } from '../../domain/types.js';
import type { AgentRepositoryPort } from '../../application/ports/agent-repository.port.js';

export class InMemoryAgentRepository implements AgentRepositoryPort {
  private readonly agents = new Map<AgentId, Agent>();
  private readonly versions = new Map<string, AgentVersion>();

  constructor(seedBuiltIns = true) {
    if (seedBuiltIns) {
      for (const entry of BUILT_IN_AGENTS) {
        this.agents.set(entry.agent.agentId, entry.agent);
        this.versions.set(`${entry.version.agentId}:${entry.version.version}`, entry.version);
      }
    }
  }

  public async getAgent(agentId: AgentId): Promise<Agent | null> {
    return this.agents.get(agentId) ?? null;
  }

  public async listAgents(category?: AgentCategory): Promise<readonly Agent[]> {
    const all = Array.from(this.agents.values());
    if (category) {
      return all.filter((a) => a.category === category);
    }
    return all;
  }

  public async saveAgent(agent: Agent): Promise<void> {
    this.agents.set(agent.agentId, agent);
  }

  public async getAgentVersion(agentId: AgentId, version: string): Promise<AgentVersion | null> {
    return this.versions.get(`${agentId}:${version}`) ?? null;
  }

  public async saveAgentVersion(version: AgentVersion): Promise<void> {
    this.versions.set(`${version.agentId}:${version.version}`, version);
  }
}
