import { Injectable, Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
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
const HARD_TIMEOUT_MS = 15_000;
const E2B_TIMEOUT_MS = 30_000;
const BLOCKED_TOOLS = new Set(['execute_custom_logic']);
const RESULT_MARKER = '__KF_RESULT__';

export type InnerToolExecutor = (
  businessId: string,
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

type ExecutorBackend = 'local' | 'e2b';

interface ActiveExecution {
  businessId: string;
  innerToolExecutor: InnerToolExecutor;
  toolCalls: number;
  expiresAt: number;
}

/**
 * The child-process harness source. Lives here (not as a .cjs file) because
 * tsc does not copy non-TS assets into dist — it is written to the OS temp
 * dir on first use and spawned from there.
 */
const HARNESS_SOURCE = `'use strict';
const send = (msg) => { if (process.send) process.send(msg); };
const logs = [];
const log = (...args) => { logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')); };
let toolSeq = 0;
const pending = new Map();
process.on('message', (msg) => {
  if (msg && msg.type === 'toolResult' && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error)); else resolve(msg.result);
  }
});
const api = {
  log,
  callTool: (name, args) => new Promise((resolve, reject) => {
    const id = ++toolSeq;
    pending.set(id, { resolve, reject });
    send({ type: 'tool', id, name, args: args ?? {} });
  }),
};
process.on('message', async (msg) => {
  if (!msg || msg.type !== 'run') return;
  try {
    const fn = new Function('api','inputs','require','process','global','globalThis','module','exports','setTimeout','setInterval','setImmediate',
      'return (async () => { ' + msg.code + ' })();');
    const value = await fn(api, msg.inputs ?? {});
    send({ type: 'done', value: value === undefined ? null : value, logs });
  } catch (err) {
    send({ type: 'error', message: err && err.message ? err.message : String(err), logs });
  }
});
send({ type: 'ready' });
`;

/**
 * The E2B-side harness: same snippet contract (api.callTool / api.log /
 * inputs), but tool calls are bridged over HTTPS to the tool-bridge endpoint
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

function harnessPath(): string {
  const p = path.join(os.tmpdir(), 'kf-code-harness.cjs');
  try {
    if (!fs.existsSync(p)) fs.writeFileSync(p, HARNESS_SOURCE, { mode: 0o600 });
  } catch {
    // fall through — spawn will surface the error
  }
  return p;
}

/**
 * The fallback executor's runtime: evaluates an LLM-written JS snippet in a
 * sandbox with a hard timeout. The only capability the snippet gets is
 * `api.callTool(name, args)`, brokered back through KEY's existing tool
 * executor — restricted to tier ≤ 2 tools so custom code can never escalate
 * into tier-3 actions.
 *
 * Two backends:
 *  - `local` (default): spawned, env-less, memory-capped child process.
 *    Honest v1 boundary, works everywhere.
 *  - `e2b`: E2B cloud microVM (real isolation). Activated when E2B_API_KEY
 *    AND PUBLIC_API_URL are set (the VM must reach our tool bridge), or when
 *    CODE_EXECUTOR_BACKEND=e2b forces it.
 */
@Injectable()
export class CodeExecutorService {
  private readonly logger = new Logger(CodeExecutorService.name);
  private readonly activeExecutions = new Map<string, ActiveExecution>();

  /** Which backend will handle executions under the current env. */
  backend(): ExecutorBackend {
    const forced = (process.env.CODE_EXECUTOR_BACKEND ?? '').toLowerCase();
    if (forced === 'e2b' || forced === 'local') return forced;
    return process.env.E2B_API_KEY && process.env.PUBLIC_API_URL ? 'e2b' : 'local';
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
    return this.executeLocal(opts);
  }

  // ── Shared tool-call validation (local IPC + E2B bridge) ───────────────

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
      this.logger.error(`E2B SDK load failed: ${(err as Error).message} — falling back to local backend`);
      return this.executeLocal(opts);
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

  // ── Local backend ──────────────────────────────────────────────────────

  private executeLocal(opts: {
    businessId: string;
    code: string;
    inputs?: Record<string, unknown>;
    innerToolExecutor: InnerToolExecutor;
  }): Promise<CodeExecutionResult> {
    const child: ChildProcess = spawn(
      process.execPath,
      ['--max-old-space-size=128', harnessPath()],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {}, timeout: HARD_TIMEOUT_MS },
    );

    let toolCalls = 0;
    let settled = false;

    return new Promise<CodeExecutionResult>((resolve) => {
      const finish = (result: CodeExecutionResult) => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
        resolve(result);
      };

      const timer = setTimeout(() => {
        this.logger.warn(`Custom logic timed out after ${HARD_TIMEOUT_MS}ms (business ${opts.businessId})`);
        finish({ ok: false, error: `Execution timed out after ${HARD_TIMEOUT_MS}ms`, logs: [], toolCalls });
      }, HARD_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timer);
        finish({ ok: false, error: `Sandbox failed: ${err.message}`, logs: [], toolCalls });
      });

      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        if (!settled && code !== 0 && signal !== 'SIGKILL') {
          finish({ ok: false, error: `Sandbox exited unexpectedly (code ${code}, signal ${signal})`, logs: [], toolCalls });
        }
      });

      child.on('message', async (msg: Record<string, unknown>) => {
        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === 'ready') {
          child.send({ type: 'run', code: opts.code, inputs: opts.inputs ?? {} });
          return;
        }

        if (msg.type === 'tool') {
          const id = msg.id as number;
          const name = String(msg.name ?? '');
          const args = (msg.args ?? {}) as Record<string, unknown>;

          const invalid = this.validateToolCall(toolCalls, name);
          if (invalid) {
            child.send({ type: 'toolResult', id, error: invalid });
            return;
          }

          toolCalls++;
          try {
            const result = await opts.innerToolExecutor(opts.businessId, name, args);
            child.send({ type: 'toolResult', id, result });
          } catch (err) {
            child.send({ type: 'toolResult', id, error: (err as Error).message });
          }
          return;
        }

        if (msg.type === 'done') {
          clearTimeout(timer);
          finish({
            ok: true,
            value: capOutput(msg.value),
            logs: capLogs((msg.logs as string[]) ?? []),
            toolCalls,
          });
          return;
        }

        if (msg.type === 'error') {
          clearTimeout(timer);
          finish({
            ok: false,
            error: String(msg.message ?? 'Unknown error'),
            logs: capLogs((msg.logs as string[]) ?? []),
            toolCalls,
          });
        }
      });
    });
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
