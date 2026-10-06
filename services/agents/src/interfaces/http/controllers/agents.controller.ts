import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentCategory, AgentId } from '../../../domain/types.js';
import type {
  GetAgentUseCase,
  ListAgentsUseCase,
  RegisterAgentCommand,
  RegisterAgentUseCase,
} from '../../../application/use-cases/catalog.use-cases.js';
import type { RequestContext } from '../context.js';
import { validateTenantHeader } from '../auth.js';
import { parseJsonBody, sendJsonResponse } from '../middleware.js';

export class AgentsController {
  constructor(
    private readonly listAgentsUseCase: ListAgentsUseCase,
    private readonly getAgentUseCase: GetAgentUseCase,
    private readonly registerAgentUseCase: RegisterAgentUseCase,
  ) {}

  public async handleList(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    validateTenantHeader(context);

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const category = url.searchParams.get('category') as AgentCategory | null;

    const agents = await this.listAgentsUseCase.execute(category ?? undefined);
    sendJsonResponse(res, 200, agents, context);
  }

  public async handleGet(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    agentId: AgentId,
  ): Promise<void> {
    validateTenantHeader(context);

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const version = url.searchParams.get('version') ?? undefined;

    const result = await this.getAgentUseCase.execute(agentId, version);
    sendJsonResponse(res, 200, result, context);
  }

  public async handleRegister(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    validateTenantHeader(context);

    const body = await parseJsonBody<RegisterAgentCommand>(req);
    await this.registerAgentUseCase.execute(body);

    sendJsonResponse(res, 201, { message: 'Agent registered successfully' }, context);
  }
}
