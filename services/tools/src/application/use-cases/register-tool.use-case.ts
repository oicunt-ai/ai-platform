import type { ToolDefinition } from '../../domain/index.js';
import { ConflictError, validateToolDefinition } from '../../domain/index.js';
import type { ToolRepositoryPort } from '../ports/tool-repository.port.js';

export class RegisterToolUseCase {
  constructor(private readonly repository: ToolRepositoryPort) {}

  public async execute(tool: ToolDefinition): Promise<void> {
    validateToolDefinition(tool);

    const existing = await this.repository.findById(tool.toolId, tool.version);
    if (existing) {
      throw new ConflictError(
        `Tool '${tool.toolId}' version '${tool.version}' already exists and cannot be modified (version immutability invariant)`,
      );
    }

    await this.repository.saveTool(tool);
  }
}
