import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { getToolByName } from './flow-tool-registry';

export interface CodeExecutionResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  logs: string[];
  toolCalls: number;
}

const MAX_TOOL_CALLS = 10;
const MAX_OUTPUT_CHARS = 4000;
const E2B_TIMEOUT_MS = 30_000;
const BLOCKED_TOOLS = new Set(['execute_custom_logic']);
const RESULT_MARKER = '__KF_RESULT__';
const DISABLED_ERROR =
  'Custom logic execution is disabled: an isolated E2B sandbox (E2B_API_KEY and PUBLIC_API_URL) is required; local API-host execution is not permitted.';

export type InnerToolExecutor = (
  businessId: string,
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

type ExecutorBackend = 'e2b' | 'disabled';

interface ActiveExecution {
  businessId: string;
  innerToolExecutor: InnerToolExecutor;
  toolCalls: number;
  expiresAt: number;
}

/**
 * The E2B-side harness: same snippet contract (api.callTool / api.log /
 * inputs), with tool calls bridged over HTTPS to the tool-bridge endpoint
 * on our own API, authenticated by a one-time execution token. Emits one
 * RESULT_MARKER JSON line on stdout for the parent to parse.
 */
const E2B_HARNESS_SOURCE = `'use strict';
const logs = [];
const api = {
  log: (...args) => logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
  callTool: async (name, args) => {
    const res = await fetch(process.env.KF_BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-exec-token': process.env.KF_EXEC_TOKEN },
      body: JSON.stringify({ name, args: args ?? {} }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(body.error || ('tool bridge HTTP ' + res.status));
    return body.result;
  },
};
(async () => {
  try {
    const fn = new Function('api', 'inputs', 'return (async () => { ' + process.env.KF_CODE + ' })();');
    const value = await fn(api, JSON.parse(process.env.KF_INPUTS || '{}'));
    console.log('${RESULT_MARKER}' + JSON.stringify({ ok: true, value: value === undefined ? null : value, logs }));
  } catch (err) {
    console.log('${RESULT_MARKER}' + JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err), logs }));
  }
})();
`;

/**
 * Isolated custom-logic executor (SEC-KEY-CUSTOM-LOGIC, P0, D-272.4):
 * Evaluates an LLM-written JS snippet ONLY inside an isolated E2B cloud microVM
 * with a hard timeout. The only capability the snippet gets is
 * `api.callTool(name, args)`, brokered back through KEY's existing tool
 * executor — restricted to tier ≤ 2 tools so custom code can never escalate
 * into tier-3 actions.
 *
 * Local API-host execution (`child_process` / `new Function`) is permanently
 * disabled: shadowing `process`/`require` in JS is trivially bypassed via the
 * Function constructor and grants full RCE on the API host. When E2B is not
 * configured or unavailable, execution fails closed.
 */
@Injectable()
export class CodeExecutorService {
  private readonly logger = new Logger(CodeExecutorService.name);
  private readonly activeExecutions = new Map<string, ActiveExecution>();

  /** Which backend will handle executions under the current env. */
  backend(): ExecutorBackend {
    const forced = (process.env.CODE_EXECUTOR_BACKEND ?? '').trim().toLowerCase();
    if (forced === 'disabled') return 'disabled';
    if (forced === 'e2b') return 'e2b';
    if (forced && forced !== 'e2b') {
      // Never honor `local` or unknown backend values — fail closed.
      return 'disabled';
    }
    return process.env.E2B_API_KEY && process.env.PUBLIC_API_URL ? 'e2b' : 'disabled';
  }

  async execute(opts: {
    businessId: string;
    code: string;
    inputs?: Record<string, unknown>;
    innerToolExecutor: InnerToolExecutor;
  }): Promise<CodeExecutionResult> {
    if (!opts.code || opts.code.length > 8000) {
      return { ok: false, error: 'Code is required (max 8000 chars)', logs: [], toolCalls: 0 };
    }
    if (this.backend() === 'e2b') {
      return this.executeE2b(opts);
    }
    return { ok: false, error: DISABLED_ERROR, logs: [], toolCalls: 0 };
  }

  // ── Tool-call validation (E2B bridge) ──────────────────────────────────

  private validateToolCall(toolCalls: number, name: string): string | null {
    if (toolCalls >= MAX_TOOL_CALLS) return `Tool call budget exceeded (max ${MAX_TOOL_CALLS})`;
    if (BLOCKED_TOOLS.has(name)) return `Tool ${name} cannot be called from custom logic`;
    const tool = getToolByName(name);
    if (!tool) return `Unknown tool ${name}`;
    const tier = tool.riskTier ?? (tool.riskLevel === 'high' ? 3 : tool.riskLevel === 'medium' ? 2 : 1);
    if (tier > 2) return `Tool ${name} is tier ${tier} — custom logic may only call tier 1-2 tools`;
    return null;
  }

  // ── Tool bridge (E2B → our API) ────────────────────────────────────────

  /**
   * Serve a tool call from inside an E2B sandbox. Token-authenticated: only
   * an execution this service minted can call, and only while it is live.
   */
  async handleToolBridge(
    token: string | undefined,
    body: { name?: string; args?: Record<string, unknown> },
  ): Promise<{ result?: unknown; error?: string }> {
    const exec = token ? this.activeExecutions.get(token) : undefined;
    if (!exec || exec.expiresAt < Date.now()) {
      if (exec) this.activeExecutions.delete(token!);
      return { error: 'Invalid or expired execution token' };
    }
    const name = String(body?.name ?? '');
    const invalid = this.validateToolCall(exec.toolCalls, name);
    if (invalid) return { error: invalid };
    exec.toolCalls++;
    try {
      const result = await exec.innerToolExecutor(exec.businessId, name, (body.args ?? {}) as Record<string, unknown>);
      return { result: result ?? null };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  // ── E2B backend ────────────────────────────────────────────────────────

  private async executeE2b(opts: {
    businessId: string;
    code: string;
    inputs?: Record<string, unknown>;
    innerToolExecutor: InnerToolExecutor;
  }): Promise<CodeExecutionResult> {
    const apiKey = process.env.E2B_API_KEY;
    const publicUrl = (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    if (!apiKey) return { ok: false, error: 'E2B_API_KEY is not configured', logs: [], toolCalls: 0 };
    if (!publicUrl) {
      return { ok: false, error: 'PUBLIC_API_URL is required for the E2B backend (the sandbox must reach our tool bridge)', logs: [], toolCalls: 0 };
    }

    // Lazy-load the ESM-only SDK from CJS (tsc would downlevel a normal
    // dynamic import() into require(), which crashes on ESM-only deps).
    let Sandbox: { create: (opts?: Record<string, unknown>) => Promise<E2bSandboxLike> };
    try {
      const importEsm = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<never>;
      const mod = await importEsm('@e2b/code-interpreter') as { Sandbox: typeof Sandbox };
      Sandbox = mod.Sandbox;
    } catch (err) {
      // SEC-KEY-CUSTOM-LOGIC (D-272.4): fail closed; never fall back to local API-host execution.
      this.logger.error(`E2B SDK load failed: ${(err as Error).message} — refusing execution (local fallback disabled)`);
      return {
        ok: false,
        error: 'Isolated E2B sandbox is unavailable (SDK load failed); local host execution is disabled.',
        logs: [],
        toolCalls: 0,
      };
    }

    const token = randomBytes(24).toString('hex');
    const exec: ActiveExecution = {
      businessId: opts.businessId,
      innerToolExecutor: opts.innerToolExecutor,
      toolCalls: 0,
      expiresAt: Date.now() + E2B_TIMEOUT_MS + 30_000,
    };
    this.activeExecutions.set(token, exec);

    let sandbox: E2bSandboxLike | undefined;
    try {
      sandbox = await Sandbox.create({ apiKey, timeoutMs: E2B_TIMEOUT_MS + 15_000 });
      const bridgeUrl = `${publicUrl}/code-executor/tool-bridge`;
      const stdout: string[] = [];
      const run = await sandbox.runCode(E2B_HARNESS_SOURCE, {
        language: 'javascript',
        envs: {
          KF_BRIDGE_URL: bridgeUrl,
          KF_EXEC_TOKEN: token,
          KF_CODE: opts.code,
          KF_INPUTS: JSON.stringify(opts.inputs ?? {}),
        },
        timeoutMs: E2B_TIMEOUT_MS,
        onStdout: (out: { line?: string }) => { if (out?.line) stdout.push(out.line); },
      } as never);

      const markerLine = stdout.filter((l) => l.includes(RESULT_MARKER)).pop();
      const stdoutLines = ((run?.logs?.stdout ?? []) as unknown[]).map((l) =>
        typeof l === 'string' ? l : ((l as { line?: string }).line ?? ''),
      );
      const jsonText = markerLine?.slice(markerLine.indexOf(RESULT_MARKER) + RESULT_MARKER.length)
        ?? stdoutLines.filter((l) => l.includes(RESULT_MARKER)).map((l) => l.slice(l.indexOf(RESULT_MARKER) + RESULT_MARKER.length)).pop();
      if (!jsonText) {
        const errText = run?.error ? `${run.error.name ?? 'E2BError'}: ${run.error.value ?? ''}` : 'no result marker in sandbox output';
        return { ok: false, error: `E2B execution failed: ${errText}`, logs: capLogs(stdout), toolCalls: exec.toolCalls };
      }
      const parsed = JSON.parse(jsonText) as { ok: boolean; value?: unknown; error?: string; logs?: string[] };
      return {
        ok: parsed.ok,
        value: capOutput(parsed.value),
        error: parsed.error,
        logs: capLogs(parsed.logs ?? []),
        toolCalls: exec.toolCalls,
      };
    } catch (err) {
      return { ok: false, error: `E2B sandbox error: ${(err as Error).message}`, logs: [], toolCalls: exec.toolCalls };
    } finally {
      this.activeExecutions.delete(token);
      try { await sandbox?.kill?.(); } catch { /* best effort */ }
    }
  }
}

interface E2bSandboxLike {
  runCode: (code: string, opts?: Record<string, unknown>) => Promise<{
    error?: { name?: string; value?: string };
    logs?: { stdout?: Array<{ line?: string } | string>; stderr?: Array<{ line?: string } | string> };
  }>;
  kill?: () => Promise<void>;
}

function capOutput(value: unknown): unknown {
  try {
    const text = JSON.stringify(value ?? null);
    if (text.length <= MAX_OUTPUT_CHARS) return value;
    return text.slice(0, MAX_OUTPUT_CHARS) + '…(truncated)';
  } catch {
    return String(value).slice(0, MAX_OUTPUT_CHARS);
  }
}

function capLogs(logs: string[]): string[] {
  return logs.slice(0, 50).map((l) => l.slice(0, 500));
}
