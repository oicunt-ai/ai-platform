import type { Agent, AgentVersion } from '../../domain/entities.js';
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  InvalidRequestError,
} from '../../domain/errors.js';
import type { AgentCategory, AgentId } from '../../domain/types.js';
import type { AgentRepositoryPort } from '../ports/agent-repository.port.js';

export class ListAgentsUseCase {
  constructor(private readonly repository: AgentRepositoryPort) {}

  public async execute(category?: AgentCategory): Promise<readonly Agent[]> {
    return this.repository.listAgents(category);
  }
}

export interface GetAgentResult {
  readonly agent: Agent;
  readonly version?: AgentVersion | undefined;
}

export class GetAgentUseCase {
  constructor(private readonly repository: AgentRepositoryPort) {}

  public async execute(agentId: AgentId, version?: string): Promise<GetAgentResult> {
    const agent = await this.repository.getAgent(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }

    if (version) {
      const agentVersion = await this.repository.getAgentVersion(agentId, version);
      if (!agentVersion) {
        throw new AgentVersionNotFoundError(agentId, version);
      }
      return { agent, version: agentVersion };
    }

    const defaultVersion = await this.repository.getAgentVersion(agentId, agent.latestVersion);
    return { agent, version: defaultVersion ?? undefined };
  }
}

export interface RegisterAgentCommand {
  readonly agent: Agent;
  readonly initialVersion?: AgentVersion | undefined;
}

export class RegisterAgentUseCase {
  constructor(private readonly repository: AgentRepositoryPort) {}

  public async execute(command: RegisterAgentCommand): Promise<void> {
    if (!command.agent.agentId || !command.agent.name) {
      throw new InvalidRequestError('agentId and name are required');
    }
    await this.repository.saveAgent(command.agent);
    if (command.initialVersion) {
      await this.repository.saveAgentVersion(command.initialVersion);
    }
  }
}
