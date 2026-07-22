import { Injectable, Logger } from '@nestjs/common';

export interface ParsedDocument {
  markdown: string;
  tablesAsText: string[];
  pageCount: number | null;
}

/**
 * Thin client over the docling-serve sidecar (docker-compose `docling`,
 * DOCLING_URL). Turns PDFs/office docs/scans into clean Markdown + table
 * text that the LLM extraction layer consumes instead of raw file bytes.
 * Fail-open: returns null when the sidecar is down so callers can fall back
 * to the legacy raw path.
 */
@Injectable()
export class DocumentParsingService {
  private readonly logger = new Logger(DocumentParsingService.name);
  private readonly baseUrl = (process.env.DOCLING_URL ?? 'http://localhost:5001').replace(/\/$/, '');

  isConfigured(): boolean {
    return true; // always tries; failures are caught and logged
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async parse(buffer: Buffer, fileName: string, mimeType?: string): Promise<ParsedDocument | null> {
    for (const path of ['/v1/convert/file', '/v1alpha/convert/file']) {
      try {
        const parsed = await this.tryConvert(buffer, fileName, mimeType, path);
        if (parsed) return parsed;
      } catch (err) {
        this.logger.warn(`docling ${path} failed for ${fileName}: ${(err as Error).message}`);
      }
    }
    return null;
  }

  private async tryConvert(
    buffer: Buffer,
    fileName: string,
    mimeType: string | undefined,
    path: string,
  ): Promise<ParsedDocument | null> {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(buffer)], { type: mimeType ?? 'application/octet-stream' }), fileName);

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      if (res.status === 404) return null; // try the other API version
      throw new Error(`docling returned ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const doc = (data.document ?? data) as Record<string, unknown>;
    const markdown = String(doc.md_content ?? doc.markdown ?? '');
    if (!markdown.trim()) {
      this.logger.warn(`docling returned empty markdown for ${fileName}`);
      return null;
    }

    const tablesAsText: string[] = [];
    const jsonContent = doc.json_content as { tables?: Array<{ data?: unknown }> } | undefined;
    if (jsonContent?.tables) {
      for (const t of jsonContent.tables.slice(0, 10)) {
        try {
          tablesAsText.push(JSON.stringify(t.data ?? t).slice(0, 2000));
        } catch {
          // skip unstringifiable tables
        }
      }
    }

    const pageCount =
      (doc.json_content as { pages?: unknown[] } | undefined)?.pages?.length ??
      (doc.pages as unknown[] | undefined)?.length ??
      null;

    return { markdown, tablesAsText, pageCount };
  }
}
