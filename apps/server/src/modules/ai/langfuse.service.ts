import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

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
 * Two deliberate choices keep this safe to ship:
 *
 * 1. It talks to Langfuse's public ingestion HTTP API directly rather than
 *    pulling in the `langfuse` SDK. No new dependency, no lockfile churn, and
 *    nothing to install in an environment that will never set the keys.
 * 2. It is env-gated and fire-and-forget. With no LANGFUSE_* keys the service
 *    reports `enabled = false` and every method returns immediately — the same
 *    degrade-don't-die contract the gateway already holds for absent providers.
 *    A failed POST is swallowed with a warn; observability must never take down
 *    the request it is observing.
 */
@Injectable()
export class LangfuseService {
  private readonly logger = new Logger(LangfuseService.name);

  private readonly publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  private readonly secretKey = process.env.LANGFUSE_SECRET_KEY;
  private readonly baseUrl = (
    process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com'
  ).replace(/\/+$/, '');

  /** True only when both keys are present; drives the no-op path everywhere else. */
  readonly enabled: boolean;

  constructor() {
    this.enabled = !!(this.publicKey && this.secretKey);
    if (!this.enabled) {
      this.logger.log(
        'LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — LLM tracing disabled (calls still routed and costed as normal)',
      );
    }
  }

  /**
   * Emit one trace + one generation for a completed LLM call. Called from the
   * gateway's cost recorders, so every field here is already computed — this
   * method neither prices nor tokenises, it only ships what it is handed.
   *
   * Never awaited by the caller and never throws: a tracing outage is invisible
   * to KEY.
   */
  traceLlmCall(input: LlmTraceInput): void {
    if (!this.enabled) return;

    const now = Date.now();
    const startedAt = new Date(now - Math.max(0, input.latencyMs)).toISOString();
    const endedAt = new Date(now).toISOString();
    const traceId = randomUUID();

    const trace = {
      id: randomUUID(),
      type: 'trace-create',
      timestamp: endedAt,
      body: {
        id: traceId,
        name: `key.${input.taskCategory}`,
        userId: input.businessId,
        sessionId: input.sessionId ?? undefined,
        tags: [
          input.provider,
          input.fallbackUsed ? 'fallback' : 'primary',
          input.source ?? 'complete',
        ],
        metadata: {
          contractType: input.contractType ?? null,
          fallbackUsed: input.fallbackUsed,
        },
      },
    };

    const generation = {
      id: randomUUID(),
      type: 'generation-create',
      timestamp: endedAt,
      body: {
        id: randomUUID(),
        traceId,
        name: input.taskCategory,
        model: input.model,
        startTime: startedAt,
        endTime: endedAt,
        usage: {
          input: input.promptTokens,
          output: input.completionTokens,
          total: input.totalTokens,
          unit: 'TOKENS',
          totalCost: input.totalCost,
        },
        metadata: {
          provider: input.provider,
          source: input.source ?? 'complete',
          latencyMs: input.latencyMs,
          fallbackUsed: input.fallbackUsed,
        },
      },
    };

    void this.ingest([trace, generation]);
  }

  private async ingest(batch: unknown[]): Promise<void> {
    try {
      const auth = Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64');
      const res = await fetch(`${this.baseUrl}/api/public/ingestion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({ batch }),
      });
      // 207 is Langfuse's partial-success code and is expected/fine.
      if (!res.ok && res.status !== 207) {
        this.logger.warn(`Langfuse ingestion returned ${res.status}`);
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Langfuse ingestion failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
