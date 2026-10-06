import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DefaultTextExtractor } from '../../src/infrastructure/extraction/default-text-extractor.js';
import { ExtractionFailedError } from '../../src/domain/errors.js';

function stringToStream(content: string): Readable {
  return Readable.from(Buffer.from(content, 'utf-8'));
}

describe('DefaultTextExtractor Boundary & Format Support', () => {
  const extractor = new DefaultTextExtractor();

  it('declares explicit supported MIME types and verifies isSupported', () => {
    expect(extractor.supportedMimeTypes).toContain('text/plain');
    expect(extractor.supportedMimeTypes).toContain('text/markdown');
    expect(extractor.supportedMimeTypes).toContain('text/x-markdown');
    expect(extractor.supportedMimeTypes).toContain('text/html');
    expect(extractor.supportedMimeTypes).toContain('application/json');
    expect(extractor.supportedMimeTypes).toContain('text/csv');
    expect(extractor.supportedMimeTypes).toContain('text/tab-separated-values');

    expect(extractor.isSupported('text/plain')).toBe(true);
    expect(extractor.isSupported('TEXT/MARKDOWN')).toBe(true);
    expect(extractor.isSupported('application/json')).toBe(true);
    expect(extractor.isSupported('text/html')).toBe(true);

    expect(extractor.isSupported('application/pdf')).toBe(false);
    expect(
      extractor.isSupported(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(false);
    expect(extractor.isSupported('image/png')).toBe(false);
    expect(extractor.isSupported('application/octet-stream')).toBe(false);
  });

  it('extracts plain text and markdown successfully', async () => {
    const textStream = stringToStream('Hello world!\nThis is a test.');
    const result = await extractor.extractText(textStream, 'text/plain');
    expect(result).toBe('Hello world!\nThis is a test.');

    const mdStream = stringToStream('# Title\n\n- item 1\n- item 2');
    const mdResult = await extractor.extractText(mdStream, 'text/markdown');
    expect(mdResult).toBe('# Title\n\n- item 1\n- item 2');
  });

  it('extracts clean text from HTML, stripping scripts, styles, and tags while decoding entities', async () => {
    const html = `
      <html>
        <head>
          <style>body { color: red; }</style>
          <script>console.log("secret");</script>
        </head>
        <body>
          <h1>Section &amp; Header</h1>
          <p>Text with &lt;brackets&gt; and &quot;quotes&quot; &amp; &apos;apostrophe&#39;.</p>
        </body>
      </html>
    `;
    const stream = stringToStream(html);
    const result = await extractor.extractText(stream, 'text/html');
    expect(result).not.toContain('color: red');
    expect(result).not.toContain('console.log');
    expect(result).toContain('Section & Header');
    expect(result).toContain('Text with <brackets> and "quotes" & \'apostrophe\'.');
  });

  it('formats valid JSON document content into clean indented JSON', async () => {
    const json = '{"service":"knowledge","version":1,"tags":["ai","rag"]}';
    const stream = stringToStream(json);
    const result = await extractor.extractText(stream, 'application/json');
    expect(result).toBe(JSON.stringify(JSON.parse(json), null, 2));
  });

  it('extracts tabular content from CSV', async () => {
    const csv = 'col1,col2,col3\nval1,val2,val3';
    const stream = stringToStream(csv);
    const result = await extractor.extractText(stream, 'text/csv');
    expect(result).toBe('col1,col2,col3\nval1,val2,val3');
  });

  it('rejects unsupported binary formats with ExtractionFailedError', async () => {
    await expect(
      extractor.extractText(stringToStream('%PDF-1.4 dummy binary content'), 'application/pdf'),
    ).rejects.toThrow(ExtractionFailedError);
    await expect(
      extractor.extractText(stringToStream('%PDF-1.4 dummy binary content'), 'application/pdf'),
    ).rejects.toThrow(/Unsupported MIME type 'application\/pdf'/);

    await expect(
      extractor.extractText(
        stringToStream('PK dummy zip content'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).rejects.toThrow(ExtractionFailedError);
  });

  it('rejects empty input stream (0 bytes) with ExtractionFailedError', async () => {
    await expect(extractor.extractText(stringToStream(''), 'text/plain')).rejects.toThrow(
      ExtractionFailedError,
    );
    await expect(extractor.extractText(stringToStream(''), 'text/plain')).rejects.toThrow(
      /Document input stream is empty/,
    );
  });

  it('rejects HTML stream that produces only whitespace after stripping', async () => {
    const rawHtml = '<script>var x = 1;</script><style>p { margin: 0; }</style>   ';
    await expect(extractor.extractText(stringToStream(rawHtml), 'text/html')).rejects.toThrow(
      ExtractionFailedError,
    );
    await expect(extractor.extractText(stringToStream(rawHtml), 'text/html')).rejects.toThrow(
      /produced empty text content/,
    );
  });

  it('rejects invalid JSON content with ExtractionFailedError', async () => {
    const rawJson = '{ broken json: ';
    await expect(
      extractor.extractText(stringToStream(rawJson), 'application/json'),
    ).rejects.toThrow(ExtractionFailedError);
    await expect(
      extractor.extractText(stringToStream(rawJson), 'application/json'),
    ).rejects.toThrow(/Failed to parse JSON document/);
  });
});
