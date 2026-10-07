export class McpMetrics {
  private rpcRequestsTotal = 0;
  private rpcErrorsTotal = 0;
  private toolCallsTotal = 0;
  private toolCallErrorsTotal = 0;
  private activeSessionsCount = 0;

  public incrementRpcRequests(): void {
    this.rpcRequestsTotal++;
  }

  public incrementRpcErrors(): void {
    this.rpcErrorsTotal++;
  }

  public incrementToolCalls(): void {
    this.toolCallsTotal++;
  }

  public incrementToolCallErrors(): void {
    this.toolCallErrorsTotal++;
  }

  public setActiveSessions(count: number): void {
    this.activeSessionsCount = count;
  }

  public getSnapshot(): Record<string, number> {
    return {
      rpcRequestsTotal: this.rpcRequestsTotal,
      rpcErrorsTotal: this.rpcErrorsTotal,
      toolCallsTotal: this.toolCallsTotal,
      toolCallErrorsTotal: this.toolCallErrorsTotal,
      activeSessionsCount: this.activeSessionsCount,
    };
  }
}

export const defaultMcpMetrics = new McpMetrics();
