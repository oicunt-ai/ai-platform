import type { Agent, AgentVersion } from '../../domain/entities.js';
import type { AgentCategory, AgentId } from '../../domain/types.js';

export interface AgentRepositoryPort {
  getAgent(agentId: AgentId): Promise<Agent | null>;
  listAgents(category?: AgentCategory): Promise<readonly Agent[]>;
  saveAgent(agent: Agent): Promise<void>;
  getAgentVersion(agentId: AgentId, version: string): Promise<AgentVersion | null>;
  saveAgentVersion(version: AgentVersion): Promise<void>;
}
