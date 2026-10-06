import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { DocumentResponseDto } from '../dtos/document.dto.js';
import { toDocumentResponseDto } from '../dtos/document.dto.js';
import { DocumentNotFoundError } from '../../domain/index.js';

export class GetDocumentUseCase {
  constructor(private readonly repository: DocumentRepositoryPort) {}

  public async execute(tenantId: string, documentId: string): Promise<DocumentResponseDto> {
    const document = await this.repository.getDocument(tenantId, documentId);
    if (!document) {
      throw new DocumentNotFoundError(documentId);
    }
    return toDocumentResponseDto(document);
  }
}
