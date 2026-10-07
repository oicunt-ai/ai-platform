export type McpServerGatewaySessionStatus = 'uninitialized' | 'active' | 'terminated';

export interface McpClientImplementationInfo {
  readonly name: string;
  readonly version: string;
}

export interface CreateServerSessionParams {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly roles: readonly string[];
  readonly clientInfo: McpClientImplementationInfo;
  readonly protocolVersion?: string | undefined;
  readonly hardExpiresAt: number;
  readonly now?: number | undefined;
}

export class McpServerGatewaySession {
  public readonly sessionId: string;
  public readonly tenantId: string;
  public readonly userId: string;
  public readonly actorId: string;
  public readonly roles: readonly string[];
  public clientInfo: McpClientImplementationInfo;
  public protocolVersion: string;
  public status: McpServerGatewaySessionStatus;
  public readonly createdAt: number;
  public lastActivityAt: number;
  public readonly hardExpiresAt: number;

  private readonly inFlightRequests = new Map<string | number, AbortController>();

  constructor(params: CreateServerSessionParams) {
    const currentTime = params.now ?? Date.now();
    this.sessionId = params.sessionId;
    this.tenantId = params.tenantId;
    this.userId = params.userId;
    this.actorId = params.actorId;
    this.roles = Object.freeze([...params.roles]);
    this.clientInfo = params.clientInfo;
    this.protocolVersion = params.protocolVersion ?? '2024-11-05';
    this.status = 'uninitialized';
    this.createdAt = currentTime;
    this.lastActivityAt = currentTime;
    this.hardExpiresAt = params.hardExpiresAt;
  }

  public isExpired(now = Date.now(), inactivityTimeoutMs: number): boolean {
    if (this.status === 'terminated') {
      return true;
    }
    if (now >= this.hardExpiresAt) {
      return true;
    }
    if (now - this.lastActivityAt >= inactivityTimeoutMs) {
      return true;
    }
    return false;
  }

  public touch(now = Date.now()): void {
    if (this.status !== 'terminated') {
      this.lastActivityAt = now;
    }
  }

  public markActive(): void {
    if (this.status !== 'terminated') {
      this.status = 'active';
    }
  }

  public registerRequest(id: string | number, controller: AbortController): void {
    this.inFlightRequests.set(id, controller);
  }

  public unregisterRequest(id: string | number): void {
    this.inFlightRequests.delete(id);
  }

  public cancelRequest(id: string | number, reason = 'Request cancelled by client'): boolean {
    const controller = this.inFlightRequests.get(id);
    if (controller) {
      controller.abort(new Error(reason));
      this.inFlightRequests.delete(id);
      return true;
    }
    return false;
  }

  public abortAll(reason = 'Session terminated'): void {
    for (const controller of this.inFlightRequests.values()) {
      controller.abort(new Error(reason));
    }
    this.inFlightRequests.clear();
  }

  public terminate(reason = 'Explicit session termination'): void {
    this.status = 'terminated';
    this.abortAll(reason);
  }

  public get activeRequestCount(): number {
    return this.inFlightRequests.size;
  }
}
