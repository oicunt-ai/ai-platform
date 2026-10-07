import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  RegisterServerUseCase,
  GetServerUseCase,
  ListServersUseCase,
  DiscoverCapabilitiesUseCase,
  DisconnectServerUseCase,
} from '../../../application/use-cases/index.js';
import type { RegisterServerDto } from '../../../application/dtos/mcp.dto.js';
import type { RequestContext } from '../context.js';
import { validateTenantHeader } from '../auth.js';
import { parseJsonBody, sendJsonResponse } from '../middleware.js';

export class ServersController {
  constructor(
    private readonly registerServerUseCase: RegisterServerUseCase,
    private readonly getServerUseCase: GetServerUseCase,
    private readonly listServersUseCase: ListServersUseCase,
    private readonly discoverCapabilitiesUseCase: DiscoverCapabilitiesUseCase,
    private readonly disconnectServerUseCase: DisconnectServerUseCase,
  ) {}

  public async handleRegister(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const body = await parseJsonBody<Partial<RegisterServerDto>>(req);

    const server = await this.registerServerUseCase.execute({
      tenantId,
      name: body.name ?? '',
      description: body.description,
      transportType: body.transportType as any,
      transportConfig: body.transportConfig as any,
      authSecretRef: body.authSecretRef,
    });

    sendJsonResponse(res, 201, { server }, context);
  }

  public async handleList(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const servers = await this.listServersUseCase.execute(tenantId);
    sendJsonResponse(res, 200, { servers }, context);
  }

  public async handleGet(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    serverId: string,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const result = await this.getServerUseCase.execute(serverId, tenantId);
    sendJsonResponse(res, 200, result, context);
  }

  public async handleRefresh(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    serverId: string,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const capabilities = await this.discoverCapabilitiesUseCase.execute(serverId, tenantId);
    sendJsonResponse(res, 200, { serverId, capabilities }, context);
  }

  public async handleDisconnect(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    serverId: string,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    await this.disconnectServerUseCase.execute(serverId, tenantId);
    sendJsonResponse(res, 200, { serverId, status: 'disconnected' }, context);
  }
}
