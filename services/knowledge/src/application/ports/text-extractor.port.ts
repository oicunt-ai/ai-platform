import type { Readable } from 'node:stream';

/**
 * MIME types genuinely supported by the default text extraction pipeline.
 * Advanced/binary formats (e.g., PDF, DOCX, audio, images) require dedicated extractor plugins.
 */
export const SUPPORTED_TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/html',
  'application/json',
  'text/csv',
  'text/tab-separated-values',
] as const;

export type SupportedTextMimeType = (typeof SUPPORTED_TEXT_MIME_TYPES)[number];

export interface TextExtractorPort {
  /**
   * The MIME types explicitly supported by this extractor implementation.
   */
  readonly supportedMimeTypes: readonly string[];

  /**
   * Checks whether the given MIME type is supported.
   */
  isSupported(mimeType: string): boolean;

  /**
   * Extracts clean normalized text from an input stream.
   * Throws ExtractionFailedError if the stream is empty, produces empty text, or is unsupported.
   */
  extractText(stream: Readable, mimeType: string): Promise<string>;
}
