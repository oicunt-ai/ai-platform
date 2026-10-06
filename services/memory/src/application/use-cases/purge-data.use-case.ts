import type { PurgeResult } from '../../domain/index.js';
import { ForbiddenError, InvalidRequestError } from '../../domain/index.js';
import type { PurgeRequestDto } from '../dtos/purge.dto.js';
import type { ConversationRepositoryPort } from '../ports/conversation-repository.port.js';

export interface PurgeDataContext {
  readonly tenantId: string;
  readonly callerServiceName?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class PurgeDataUseCase {
  constructor(private readonly repository: ConversationRepositoryPort) {}

  public async execute(dto: PurgeRequestDto, context: PurgeDataContext): Promise<PurgeResult> {
    if (!context.tenantId || context.tenantId.trim().length === 0) {
      throw new InvalidRequestError('Tenant ID is required for purge');
    }
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new InvalidRequestError('A compliance reason is required for purge');
    }

    // Only administrative services can perform purge
    if (context.callerServiceName && context.callerServiceName !== 'ai-platform-admin') {
      throw new ForbiddenError(
        `Service '${context.callerServiceName}' is not authorized to execute data purges`,
      );
    }

    return this.repository.purgeTenantOrUserData(
      context.tenantId,
      dto.userId?.trim() || undefined,
      context.signal,
    );
  }
}
