import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  ToolCategory,
  ToolDefinition,
  ToolExportFormat,
  ToolId,
} from '../../../domain/index.js';
import type {
  DiscoverToolsUseCase,
  GetToolUseCase,
  RegisterToolUseCase,
} from '../../../application/use-cases/index.js';
import type { RequestContext } from '../context.js';
import { validateTenantHeader } from '../auth.js';
import { parseJsonBody, sendJsonResponse } from '../middleware.js';

export class ToolsController {
  constructor(
    private readonly discoverToolsUseCase: DiscoverToolsUseCase,
    private readonly getToolUseCase: GetToolUseCase,
    private readonly registerToolUseCase: RegisterToolUseCase,
  ) {}

  public async handleList(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const url = new URL(req.url ?? '/', 'http://localhost');

    const product = url.searchParams.get('product') ?? undefined;
    const category = (url.searchParams.get('category') as ToolCategory) ?? undefined;
    const capabilities = url.searchParams.get('capabilities') ?? undefined;
    const format = (url.searchParams.get('format') as ToolExportFormat) ?? undefined;

    const tools = await this.discoverToolsUseCase.execute({
      tenantId,
      actorId: context.actorId ?? 'system',
      actorRoles: context.actorRoles,
      product,
      category,
      capabilities,
      format,
    });

    sendJsonResponse(res, 200, { tools }, context);
  }

  public async handleGet(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    toolId: ToolId,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const version = url.searchParams.get('version') ?? undefined;

    const tool = await this.getToolUseCase.execute({
      toolId,
      version,
      tenantId,
      actorId: context.actorId ?? 'system',
      actorRoles: context.actorRoles,
    });

    sendJsonResponse(res, 200, tool, context);
  }

  public async handleRegister(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    const body = await parseJsonBody<ToolDefinition>(req);
    await this.registerToolUseCase.execute(body);
    sendJsonResponse(
      res,
      201,
      { registered: true, toolId: body.toolId, version: body.version },
      context,
    );
  }
}
