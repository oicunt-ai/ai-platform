import type { Readable } from 'node:stream';
import type { TextExtractorPort } from '../../application/ports/text-extractor.port.js';
import { SUPPORTED_TEXT_MIME_TYPES } from '../../application/ports/text-extractor.port.js';
import { ExtractionFailedError } from '../../domain/errors.js';

export class DefaultTextExtractor implements TextExtractorPort {
  public readonly supportedMimeTypes: readonly string[] = SUPPORTED_TEXT_MIME_TYPES;

  public isSupported(mimeType: string): boolean {
    const normalized = mimeType.toLowerCase().trim();
    return (this.supportedMimeTypes as readonly string[]).includes(normalized);
  }

  public async extractText(stream: Readable, mimeType: string): Promise<string> {
    const normalizedMime = mimeType.toLowerCase().trim();

    if (!this.isSupported(normalizedMime)) {
      throw new ExtractionFailedError(
        `Unsupported MIME type '${mimeType}'. DefaultTextExtractor only supports plain text, markdown, HTML, CSV, TSV, and JSON. Specialized extraction (e.g. PDF, DOCX, OCR) requires dedicated extractor plugins.`,
      );
    }

    const rawBuffer = await this.streamToBuffer(stream);
    if (rawBuffer.length === 0) {
      throw new ExtractionFailedError('Document input stream is empty (0 bytes)');
    }

    const rawText = rawBuffer.toString('utf-8');

    let text: string;
    if (normalizedMime === 'text/html') {
      text = this.extractFromHtml(rawText);
    } else if (normalizedMime === 'application/json') {
      text = this.extractFromJson(rawText);
    } else {
      // plain text, markdown, csv, tab-separated-values
      text = rawText.trim();
    }

    if (text.length === 0) {
      throw new ExtractionFailedError('Document produced empty text content during extraction');
    }

    return text;
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private extractFromHtml(html: string): string {
    // Strip script and style blocks
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
    // Strip HTML tags
    text = text.replace(/<[^>]+>/g, ' ');
    // Unescape common entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
    // Collapse excess whitespace
    return text.replace(/\s+/g, ' ').trim();
  }

  private extractFromJson(jsonStr: string): string {
    try {
      const parsed = JSON.parse(jsonStr);
      return JSON.stringify(parsed, null, 2);
    } catch {
      throw new ExtractionFailedError('Failed to parse JSON document: invalid JSON syntax');
    }
  }
}
