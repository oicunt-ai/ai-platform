# Document Processing Worker (`workers/document-processing/`)

Asynchronous background worker responsible for document ingestion, file parsing, multimodal extraction, and semantic chunking.

---

## 1. Scope & Responsibility

- Ingests raw files (PDF, DOCX, XLSX, HTML, TXT, images) from object storage.
- Performs text extraction, table extraction, and OCR when necessary.
- Applies document-aware token chunking strategies (semantic, recursive, hierarchical).
- Emits chunked payloads for vector embedding ingestion.

## 2. Invariants

- Document extraction processes are isolated in sandboxed workers to protect against malicious file payloads.
- Preserves document hierarchy and provenance metadata across chunks (page number, section header, byte offset).
- Operates statelessly with idempotent job processing.
