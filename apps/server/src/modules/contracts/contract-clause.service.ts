import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../core/prisma/prisma.service';
import { DocumentParsingService } from '../ingestion/document-parsing.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { isIP } from 'node:net';
import {
  CheckedAddress,
  OutboundAddressRefusedError,
  PinnedDispatcher,
  isNonPublicAddress,
  resolvePublicAddress,
} from '../../core/security/outbound-address';

/** The 41 CUAD clause labels (Contract Understanding Atticus Dataset). */
export const CUAD_LABELS = [
  'Document Name', 'Parties', 'Agreement Date', 'Effective Date', 'Expiration Date',
  'Renewal Term', 'Notice Period To Terminate Renewal', 'Governing Law', 'Most Favored Nation',
  'Non-Compete', 'Exclusivity', 'No-Solicit Of Customers', 'No-Solicit Of Employees',
  'Non-Disparagement', 'Termination For Convenience', 'Right Of First Refusal',
  'Right Of First Offer', 'Right Of First Negotiation', 'Change Of Control',
  'Anti-Assignment', 'Revenue/Profit Sharing', 'Price Restrictions', 'Minimum Commitment',
  'Volume Restriction', 'IP Ownership Assignment', 'Joint IP Ownership', 'License Grant',
  'Non-Transferable License', 'Affiliate License-License', 'Affiliate License-IP',
  'Unlimited/All-You-Can-Eat-License', 'Irrevocable Or Perpetual License', 'Source Code Escrow',
  'Post-Termination Services', 'Cap On Liability', 'Liquidated Damages',
  'Warranty Duration', 'Insurance', 'Indemnification', 'Indemnification Of IP Claims',
  'Limitation Of Liability', 'Covenant Not To Sue',
] as const;

export interface ClauseFinding {
  label: string;
  present: boolean;
  summary?: string;
  sourceText?: string;
  importance?: 'standard' | 'notable' | 'critical';
  confidence?: number;
}

export interface ClauseAnalysisResult {
  analyzedAt: string;
  source: string;
  total: number;
  present: ClauseFinding[];
  notableAbsent: string[];
  clauses: ClauseFinding[];
}

/**
 * W11-DISPATCH-REFUSAL-FINAL review SEC-1, COR-1 (owner ruling D-134): the cause on the 400
 * extractClauses answers when the host of the contract's document did not answer (5xx, 408, 429).
 * The 400 is what it always was (same status, message and body; a cause is not serialized). KEY's
 * contract_extract_clauses, this service's only caller, reads the cause to hand its plan queue a
 * failure worth retrying instead of a final refusal.
 */
export class DocumentHostUnavailableError extends Error {
  constructor(readonly hostStatus: number) {
    super(`The document host answered ${hostStatus}`);
    this.name = 'DocumentHostUnavailableError';
  }
}

function isDocumentHostOutage(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * FU-CONTRACT-FETCH-OUTBOUND-GUARD (owner ruling D-246): the one answer to a document URL the server may
 * not fetch (a non-public address by any spelling or by DNS, a redirect to one, a scheme other than http
 * and https, credentials in the URL, a URL that does not parse, a host that does not resolve, a redirect
 * chain past MAX_DOCUMENT_REDIRECTS). It names no address, no reason and no upstream status, so it tells
 * the member nothing about the server's network. It is a final 400 (no cause): no outage.
 */
export const DOCUMENT_URL_REFUSED = 'The document URL must be a public http or https address';

/** FU-CONTRACT-FETCH-OUTBOUND-GUARD: redirects a document fetch follows, each one checked before it is requested. */
const MAX_DOCUMENT_REDIRECTS = 5;

const documentUrlRefused = () => new BadRequestException(DOCUMENT_URL_REFUSED);

/**
 * FU-CONTRACT-FETCH-OUTBOUND-GUARD acceptance review (correctness M2): a redirect chain past
 * MAX_DOCUMENT_REDIRECTS. Every host on it was public, so DOCUMENT_URL_REFUSED would be untrue; this is its own
 * final 400 (no cause, not retried) and names no host.
 */
export const DOCUMENT_URL_TOO_MANY_REDIRECTS = 'The document URL redirected too many times';

/** The deadline of a document fetch in production; ContractClauseService.documentFetchTimeoutMs. */
export const DOCUMENT_FETCH_TIMEOUT_MS = 30_000;

/**
 * FU-DOC-FETCH-BODY-CAP (P111 / D-246): maximum decompressed bytes read from a fetched contract
 * document (opts.url or contract.sourceAssetId). No asset-module upload limit exists; 25 MB bounds
 * memory against oversized streams and gzip/deflate/brotli bombs.
 */
export const MAX_DOCUMENT_FETCH_BYTES = 25 * 1024 * 1024;

/**
 * FU-DOC-FETCH-BODY-CAP: final 400 message when a fetched document exceeds MAX_DOCUMENT_FETCH_BYTES.
 * Names the limit, never the host, and carries no outage cause (not retried by the plan queue).
 */
export const DOCUMENT_BODY_TOO_LARGE = `The document exceeds the ${MAX_DOCUMENT_FETCH_BYTES / (1024 * 1024)} MB limit`;

function documentBodyTooLarge(maxBytes: number): BadRequestException {
  const limitLabel =
    maxBytes % (1024 * 1024) === 0
      ? `${maxBytes / (1024 * 1024)} MB`
      : `${maxBytes} bytes`;
  return new BadRequestException(`The document exceeds the ${limitLabel} limit`);
}

function declaredContentLengthExceeds(res: Response, maxBytes: number): boolean {
  const raw = res.headers.get('content-length');
  if (!raw) return false;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    const len = Number(trimmed);
    if (!Number.isNaN(len) && len > maxBytes) return true;
  }
  return false;
}

/**
 * FU-CONTRACT-FETCH-OUTBOUND-GUARD acceptance review (correctness M1): give up a response body that will not
 * be read, so the connection is released now rather than when the host ends it (the per-hop dispatcher's
 * close() waits for a body in flight).
 */
async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* a body already read or cancelled */
  }
}

/**
 * FU-DOC-FETCH-BODY-CAP (P111 / D-246): read a fetched document body with a hard cap on decompressed
 * bytes. Rejects an oversized Content-Length up front before touching the stream, then streams
 * `res.body` (already decompressed by fetch for gzip/deflate/brotli) with a running byte counter and
 * cancels/aborts the moment cumulative bytes exceed `maxBytes` so the socket closes immediately.
 */
async function readDocumentBody(
  res: Response,
  maxBytes: number,
  signal: AbortSignal,
  abort: () => void,
): Promise<Buffer> {
  if (declaredContentLengthExceeds(res, maxBytes)) {
    const cancelPromise = discardBody(res);
    abort();
    await cancelPromise;
    throw documentBodyTooLarge(maxBytes);
  }
  if (signal.aborted) {
    await discardBody(res);
    throw signal.reason;
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    if (typeof res.arrayBuffer !== 'function') return Buffer.alloc(0);
    const ab: ArrayBuffer | ArrayBufferView = await underSignal(res.arrayBuffer(), signal);
    if (ab.byteLength > maxBytes) {
      abort();
      throw documentBodyTooLarge(maxBytes);
    }
    return ArrayBuffer.isView(ab)
      ? Buffer.from(ab.buffer, ab.byteOffset, ab.byteLength)
      : Buffer.from(ab);
  }

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let finished = false;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => undefined);

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) {
        finished = true;
        break;
      }
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw documentBodyTooLarge(maxBytes);
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (!finished) {
      const cancelPromise = reader.cancel().catch(() => undefined);
      abort();
      await cancelPromise;
    }
    reader.releaseLock();
  }
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
}

/**
 * FU-CONTRACT-FETCH-OUTBOUND-GUARD review round 1 (correctness 1, security 1): the resolver could not answer
 * now (EAI_AGAIN, a timeout, a server failure; OutboundAddressRefusedError.transient). That says nothing
 * about the name, so it is no refusal: it stays the plain failure a fetch whose lookup failed was before
 * the guard (no HttpException), which the plan queue retries and counts. It names no host and no code.
 */
export class DocumentHostUnresolvedError extends Error {
  constructor() {
    super('The document host could not be resolved right now');
    this.name = 'DocumentHostUnresolvedError';
  }
}

/**
 * FU-CONTRACT-FETCH-OUTBOUND-GUARD review round 1 (correctness 2): the fetch's deadline bounds resolving each
 * host as well as the requests (fetch rejects with the signal's reason, a TimeoutError, as it did before
 * the guard when its own lookup stalled).
 */
function underSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}

/**
 * FU-CONTRACT-FETCH-OUTBOUND-GUARD (D-246): the URL of a contract's document, checked as webhooks and the
 * CRM link import check theirs (core/security/outbound-address.ts): http or https only, no credentials, no
 * localhost name, an IP literal that is public (WHATWG URL has already turned a decimal, octal or hex IPv4
 * spelling into its dotted form), and a name resolved once with every address public. The addresses that
 * were checked are the only ones the fetch may connect to (PinnedDispatcher). Any refusal is
 * DOCUMENT_URL_REFUSED.
 */
async function checkDocumentUrl(raw: string): Promise<{ url: URL; target: CheckedAddress }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw documentUrlRefused();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw documentUrlRefused();
  if (url.username || url.password) throw documentUrlRefused();
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) throw documentUrlRefused();
  if (isIP(hostname) !== 0 && isNonPublicAddress(hostname)) throw documentUrlRefused();
  try {
    return { url, target: await resolvePublicAddress(hostname) };
  } catch (err) {
    if (err instanceof OutboundAddressRefusedError) throw err.transient ? new DocumentHostUnresolvedError() : documentUrlRefused();
    throw err;
  }
}

interface FetchedDocument {
  response: Response;
  signal: AbortSignal;
  abort: () => void;
}

/**
 * FU-CONTRACT-FETCH-OUTBOUND-GUARD (D-246): fetch a contract's document from a URL a member gave (the call's
 * url or the contract's asset). Each request goes through a dispatcher pinned to the addresses its host was
 * checked at, so a second DNS answer (rebinding) is never connected to; fetch does not follow a redirect on
 * its own (redirect 'manual'): each target is checked the same way before it is requested, at most
 * MAX_DOCUMENT_REDIRECTS of them. A host that answered (any status but a redirect) is handed back as it
 * answered, so the caller's outage marking (W11-DISPATCH-REFUSAL-FINAL, D-134) is unchanged.
 */
async function fetchDocument(raw: string, timeoutMs: number): Promise<FetchedDocument> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  let { url, target } = await underSignal(checkDocumentUrl(raw), signal);
  for (let hops = 0; ; hops++) {
    const dispatcher = new PinnedDispatcher(target);
    let response: Response;
    try {
      response = await fetch(url.toString(), { redirect: 'manual', dispatcher, signal } as RequestInit);
    } finally {
      // close() lets the request in flight finish, its body included, then ends the connection.
      dispatcher.close().catch(() => undefined);
    }
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return { response, signal, abort };
    await discardBody(response);
    if (hops >= MAX_DOCUMENT_REDIRECTS) throw new BadRequestException(DOCUMENT_URL_TOO_MANY_REDIRECTS);
    let next: string;
    try {
      next = new URL(location, url).toString();
    } catch {
      throw documentUrlRefused();
    }
    ({ url, target } = await underSignal(checkDocumentUrl(next), signal));
  }
}

/**
 * CUAD-style contract clause extraction on top of the Docling parse layer:
 * contract source -> parsed markdown -> GPT-4o with the 41-label checklist as
 * a structured checklist -> persisted on the contract record. Output always
 * routes through human review (contract stays in `reviewing` flows) — zero-shot
 * clause extraction is advisory, not authoritative.
 */
@Injectable()
export class ContractClauseService {
  private readonly logger = new Logger(ContractClauseService.name);

  /**
   * FU-CONTRACT-FETCH-OUTBOUND-GUARD acceptance review (correctness M4): the deadline of one document fetch,
   * DNS and every redirect hop included. DOCUMENT_FETCH_TIMEOUT_MS (30 s); only a test shortens it.
   */
  documentFetchTimeoutMs = DOCUMENT_FETCH_TIMEOUT_MS;

  /**
   * FU-DOC-FETCH-BODY-CAP: maximum decompressed bytes read from a remote document fetch
   * (opts.url or contract.sourceAssetId). MAX_DOCUMENT_FETCH_BYTES (25 MB) in production.
   */
  documentFetchMaxBytes = MAX_DOCUMENT_FETCH_BYTES;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private getDocling() {
    return this.moduleRef.get(DocumentParsingService, { strict: false });
  }
  private getAiUsage() {
    return this.moduleRef.get(AiUsageService, { strict: false });
  }

  async extractClauses(
    businessId: string,
    contractId: string,
    opts: { url?: string; base64Content?: string; mimeType?: string; filename?: string },
  ): Promise<ClauseAnalysisResult> {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, businessId },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    const { buffer, mimeType, filename, source, hostOutage } = await this.resolveBytes(businessId, contract, opts);
    if (!buffer) {
      throw new BadRequestException(
        'No source document available for this contract (upload one or link an asset/document)',
        hostOutage ? { cause: new DocumentHostUnavailableError(hostOutage), description: 'Bad Request' } : undefined,
      );
    }

    const parsed = await this.getDocling().parse(buffer, filename, mimeType);
    const text = parsed?.markdown ?? buffer.toString('utf8');
    if (!text.trim()) {
      throw new BadRequestException('Could not extract any text from the source document');
    }

    const prompt = this.buildClausePrompt(text.slice(0, 14000), contract.title ?? filename);
    const response = await this.getAiUsage().trackAndComplete(
      businessId,
      undefined,
      'contract_clause_extract',
      {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: 'Analyze the contract against the checklist and respond with the JSON object only.' },
        ],
        maxTokens: 3000,
        temperature: 0,
      } as never,
    );

    const findings = this.parseFindings(String(response.content ?? ''));
    const result: ClauseAnalysisResult = {
      analyzedAt: new Date().toISOString(),
      source,
      total: findings.length,
      present: findings.filter((c) => c.present),
      notableAbsent: findings.filter((c) => !c.present && (c.importance === 'notable' || c.importance === 'critical')).map((c) => c.label),
      clauses: findings,
    };

    await this.prisma.client.contract.update({
      where: { id: contract.id },
      data: { clauseAnalysis: result as unknown as object },
    });

    return result;
  }

  private async resolveBytes(
    businessId: string,
    contract: { sourceAssetId?: string | null; sourceDocumentInstanceId?: string | null; sourceDriveFileId?: string | null; title?: string | null },
    opts: { url?: string; base64Content?: string; mimeType?: string; filename?: string },
  ): Promise<{ buffer: Buffer | null; mimeType: string; filename: string; source: string; hostOutage?: number }> {
    if (opts.base64Content) {
      return {
        buffer: Buffer.from(opts.base64Content, 'base64'),
        mimeType: opts.mimeType ?? 'application/pdf',
        filename: opts.filename ?? 'contract.pdf',
        source: 'upload',
      };
    }
    if (opts.url) {
      // FU-CONTRACT-FETCH-OUTBOUND-GUARD (D-246): a URL the server may not fetch is DOCUMENT_URL_REFUSED.
      const { response: res, signal, abort } = await fetchDocument(opts.url, this.documentFetchTimeoutMs);
      if (!res.ok) {
        await discardBody(res);
        abort();
        throw new BadRequestException(
          `Could not fetch document URL (${res.status})`,
          isDocumentHostOutage(res.status) ? { cause: new DocumentHostUnavailableError(res.status), description: 'Bad Request' } : undefined,
        );
      }
      return {
        buffer: await readDocumentBody(res, this.documentFetchMaxBytes, signal, abort),
        mimeType: res.headers.get('content-type') ?? 'application/pdf',
        filename: opts.filename ?? 'contract.pdf',
        source: 'url',
      };
    }

    if (contract.sourceAssetId) {
      const asset = await this.prisma.client.asset.findFirst({ where: { id: contract.sourceAssetId, businessId } });
      if (asset?.url && asset.url.startsWith('http')) {
        // FU-CONTRACT-FETCH-OUTBOUND-GUARD (D-246): the asset's URL passes the same guard.
        const { response: res, signal, abort } = await fetchDocument(asset.url, this.documentFetchTimeoutMs);
        if (res.ok) {
          return {
            buffer: await readDocumentBody(res, this.documentFetchMaxBytes, signal, abort),
            mimeType: asset.mimeType ?? 'application/pdf',
            filename: asset.name ?? 'asset',
            source: 'asset',
          };
        }
        await discardBody(res);
        abort();
        // W11-DISPATCH-REFUSAL-FINAL review COR-1 (D-134): the asset's host did not answer (5xx, 408,
        // 429). What extractClauses answers is unchanged (its 400 'No source document available');
        // the host's status rides on it as its cause, so KEY's plan queue can tell an outage from a
        // contract that has no document and retry it (flow-orchestrator's contract_extract_clauses).
        if (isDocumentHostOutage(res.status)) {
          return { buffer: null, mimeType: 'application/pdf', filename: 'contract.pdf', source: 'none', hostOutage: res.status };
        }
      }
    }

    return { buffer: null, mimeType: 'application/pdf', filename: 'contract.pdf', source: 'none' };
  }

  private buildClausePrompt(contractText: string, title: string): string {
    return `You are a contract analysis engine. Analyze the contract below against this exact 41-label checklist (CUAD taxonomy):
${CUAD_LABELS.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Rules:
- For EVERY label, decide present: true/false.
- When present, add a one-sentence summary, the closest sourceText snippet (max 200 chars), and importance (standard|notable|critical).
- When absent, include only the label and importance (mark critical only for clauses whose absence is a material risk: Indemnification, Cap On Liability, Limitation Of Liability, Termination For Convenience, Governing Law, IP Ownership Assignment, License Grant, Insurance).
- confidence: 0.0-1.0 per finding.
- Respond ONLY with valid JSON: {"clauses": [{"label": "...", "present": true|false, "summary": "...", "sourceText": "...", "importance": "...", "confidence": 0.0}]}

CONTRACT (${title}):
"""
${contractText}
"""`;
  }

  private parseFindings(raw: string): ClauseFinding[] {
    try {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) return [];
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { clauses?: ClauseFinding[] };
      if (!Array.isArray(parsed.clauses)) return [];
      return parsed.clauses.filter((c) => typeof c?.label === 'string');
    } catch (err) {
      this.logger.warn(`Clause JSON parse failed: ${(err as Error).message}`);
      return [];
    }
  }
}
