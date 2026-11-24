import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { errorRegistry } from '../../core/observability/error-registry';

/**
 * LLM observability shim for Langfuse (https://langfuse.com).
 *
 * KEY runs on the model gateway, which fans every request across six
 * providers with fallback, BYOK, budget caps and streaming. `llm-cost` already
 * records tokens and dollars per call, but nothing lets us see the *shape* of a
 * call — the trace, the latency distribution, which task categories fall back,
 * where quality drifts. That is what Langfuse is for, and the gateway's two
 * cost recorders (`recordCostFromResponse` / `recordCostFromStream`) are the
 * one seam every completion already passes through.
 *
 * Wire contract (RR-LANGFUSE-INGESTION-CUTOVER, KF-ASSURANCE-OTEL-LANGFUSE-
 * COMPAT-001): one OTLP/HTTP JSON `ExportTraceServiceRequest` per completed
 * call, POSTed to `${baseUrl}/api/public/otel/v1/traces` with the same Basic
 * auth as before. The legacy ingestion batch endpoint, which Langfuse Cloud
 * removes on 2026-11-16, is gone (the spec forbids its path and its event
 * types anywhere in this file, comments included). The request is still
 * hand-built: the OTel SDK would need its own dependency ruling. One span per
 * call, `gen_ai.*` attributes for provider, model, tokens and cost, `key.*`
 * attributes for the business id, task category, fallback and source,
 * `langfuse.session.id` when the call has a session, and no user id (the old
 * shim sent the business id as `userId`). Metadata only: no prompt or
 * completion text is ever handed to this service.
 *
 * Three deliberate choices keep this safe to ship:
 *
 * 1. No new dependency, no lockfile churn, and nothing to install in an
 *    environment that will never set the keys.
 * 2. It is env-gated and fire-and-forget. With no LANGFUSE_* keys the service
 *    reports `enabled = false` and every method returns immediately — the same
 *    degrade-don't-die contract the gateway already holds for absent providers.
 *    A failed export never reaches the request it is observing.
 * 3. A failed export is not silent: every non-2xx answer, timeout or thrown
 *    fetch increments `exportFailures` and is recorded as `langfuse.export` in
 *    the error registry, so it shows on the super-admin GET
 *    api/diagnostics/errors next to the other background failures.
 */
@Injectable()
export class LangfuseService {
  private readonly logger = new Logger(LangfuseService.name);

  private readonly publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  private readonly secretKey = process.env.LANGFUSE_SECRET_KEY;
  private readonly baseUrl = (
    process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com'
  ).replace(/\/+$/, '');

  /**
   * Per-request wall-clock bound. Because the export is unawaited and one fires
   * per completion, an endpoint that accepts connections but never responds
   * would otherwise let pending requests — and their sockets — pile up without
   * limit. The abort caps each one so a slow Langfuse can never leak resources
   * into KEY.
   */
  private readonly timeoutMs = Number(process.env.LANGFUSE_TIMEOUT_MS) || 5000;

  /** True only when both keys are present; drives the no-op path everywhere else. */
  readonly enabled: boolean;

  /** Exports that did not get a 2xx: non-2xx answers, timeouts and thrown fetches, since boot. */
  private failures = 0;

  constructor() {
    this.enabled = !!(this.publicKey && this.secretKey);
    if (!this.enabled) {
      this.logger.log(
        'LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — LLM tracing disabled (calls still routed and costed as normal)',
      );
    }
  }

  /** How many exports failed since boot. The same failures are in the error registry under `langfuse.export`. */
  get exportFailures(): number {
    return this.failures;
  }

  /**
   * Emit one span for a completed LLM call. Called from the gateway's cost
   * recorders, so every field here is already computed — this method neither
   * prices nor tokenises, it only ships what it is handed.
   *
   * Never awaited by the caller and never throws: a tracing outage is invisible
   * to KEY's request, and visible on the diagnostics route.
   */
  traceLlmCall(input: LlmTraceInput): void {
    if (!this.enabled) return;
    // Building the payload is part of the export, not of the caller's turn: a
    // shape error here is counted like a failed POST and never thrown back into
    // the gateway, where it would skip the cost write that follows this call.
    let payload: ExportTraceServiceRequest;
    try {
      payload = buildTraceExport(input);
    } catch (err: unknown) {
      this.exportFailed(err);
      return;
    }
    void this.exportSpan(payload);
  }

  private async exportSpan(payload: ExportTraceServiceRequest): Promise<void> {
    try {
      const auth = Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64');
      const res = await fetch(`${this.baseUrl}/api/public/otel/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      // OTLP/HTTP answers 2xx for success and for partial success (the body
      // then carries `partialSuccess`); anything else is a failed export.
      if (!res.ok) this.exportFailed(new Error(`Langfuse OTLP export returned HTTP ${res.status}`));
    } catch (err: unknown) {
      this.exportFailed(err);
    }
  }

  private exportFailed(err: unknown): void {
    this.failures += 1;
    // The registry keeps the message, redacted by its own rules; the log names
    // only the class, because fetch echoes the request URL (base URL included,
    // credentials and all) into some of its errors.
    errorRegistry.record('other', 'langfuse.export', err);
    const kind = err instanceof Error ? err.name : typeof err;
    this.logger.warn(
      `Langfuse export failed (${kind}); ${this.failures} since boot, detail on GET api/diagnostics/errors as langfuse.export`,
    );
  }
}

export interface LlmTraceInput {
  businessId: string;
  sessionId?: string | null;
  provider: string;
  model: string;
  taskCategory: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCost: number;
  latencyMs: number;
  fallbackUsed: boolean;
  contractType?: string | null;
  /** 'complete' for buffered calls, 'stream' for streamed ones. */
  source?: 'complete' | 'stream';
}

// ---------------------------------------------------------------------------
// OTLP/HTTP JSON encoding of one span (opentelemetry-proto, JSON mapping:
// trace and span ids are lowercase hex, 64-bit integers are decimal strings).

type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };
interface KeyValue {
  key: string;
  value: AnyValue;
}
interface ExportTraceServiceRequest {
  resourceSpans: Array<{
    resource: { attributes: KeyValue[] };
    scopeSpans: Array<{
      scope: { name: string };
      spans: Array<{
        traceId: string;
        spanId: string;
        name: string;
        kind: number;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
        attributes: KeyValue[];
        status: { code: number };
      }>;
    }>;
  }>;
}

const SPAN_KIND_CLIENT = 3;
const STATUS_CODE_OK = 1;

function str(key: string, value: string): KeyValue {
  return { key, value: { stringValue: value } };
}
/** A finite number or 0: NaN and Infinity are not valid int64/double in the proto JSON mapping. */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
function int(key: string, value: number): KeyValue {
  return { key, value: { intValue: String(Math.trunc(finite(value))) } };
}
function dbl(key: string, value: number): KeyValue {
  return { key, value: { doubleValue: finite(value) } };
}
function bool(key: string, value: boolean): KeyValue {
  return { key, value: { boolValue: value } };
}

/**
 * The export for one call. Pure, so the shape is testable without a socket.
 * The attribute set is closed on purpose: only what the gateway already
 * computed, never a user id, never prompt or completion text.
 */
export function buildTraceExport(input: LlmTraceInput, now = Date.now()): ExportTraceServiceRequest {
  // Whole milliseconds: BigInt() rejects fractions, and a non-finite latency is no latency.
  const latencyMs = Math.max(0, Math.round(finite(input.latencyMs)));
  const endMs = Math.round(now);
  const startMs = endMs - latencyMs;
  const attributes: KeyValue[] = [
    str('gen_ai.system', input.provider),
    str('gen_ai.request.model', input.model),
    str('gen_ai.response.model', input.model),
    int('gen_ai.usage.input_tokens', input.promptTokens),
    int('gen_ai.usage.output_tokens', input.completionTokens),
    int('gen_ai.usage.total_tokens', input.totalTokens),
    dbl('gen_ai.usage.cost', input.totalCost),
    str('key.business_id', input.businessId),
    str('key.task_category', input.taskCategory),
    bool('key.fallback_used', input.fallbackUsed),
    str('key.source', input.source ?? 'complete'),
    int('key.latency_ms', latencyMs),
  ];
  if (input.contractType) attributes.push(str('key.contract_type', input.contractType));
  if (input.sessionId) attributes.push(str('langfuse.session.id', input.sessionId));

  return {
    resourceSpans: [
      {
        resource: { attributes: [str('service.name', 'keyflowos-server')] },
        scopeSpans: [
          {
            scope: { name: 'keyflowos.model-gateway' },
            spans: [
              {
                traceId: randomBytes(16).toString('hex'),
                spanId: randomBytes(8).toString('hex'),
                name: `key.${input.taskCategory}`,
                kind: SPAN_KIND_CLIENT,
                startTimeUnixNano: `${BigInt(startMs) * 1_000_000n}`,
                endTimeUnixNano: `${BigInt(endMs) * 1_000_000n}`,
                attributes,
                status: { code: STATUS_CODE_OK },
              },
            ],
          },
        ],
      },
    ],
  };
}
