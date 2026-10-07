export interface McpToolDefinitionDto {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpTextContent {
  readonly type: 'text';
  readonly text: string;
}

export interface McpConfirmationChallengeDto {
  readonly status: 'confirmation_required';
  readonly challengeToken: string;
  readonly toolId: string;
  readonly expiresAt: string;
  readonly confirmationId?: string | undefined;
}

export interface McpCallToolResult {
  readonly content: readonly McpTextContent[];
  readonly isError?: boolean | undefined;
  readonly _confirmationChallenge?: McpConfirmationChallengeDto | undefined;
}
