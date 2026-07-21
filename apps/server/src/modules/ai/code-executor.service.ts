import { Injectable, Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
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
const BLOCKED_TOOLS = new Set(['execute_custom_logic']);

export type InnerToolExecutor = (
  businessId: string,
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

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
 * spawned, env-less, memory-capped child process with a hard kill timeout.
 * The only capability the snippet gets is `api.callTool(name, args)`, which
 * is brokered back through KEY's existing tool executor — restricted to
 * tier ≤ 2 tools so custom code can never escalate into tier-3 actions.
 *
 * Process isolation + timeouts is the honest v1 boundary; swap the backend
 * to E2B microVMs later without changing callers.
 */
@Injectable()
export class CodeExecutorService {
  private readonly logger = new Logger(CodeExecutorService.name);

  async execute(opts: {
    businessId: string;
    code: string;
    inputs?: Record<string, unknown>;
    innerToolExecutor: InnerToolExecutor;
  }): Promise<CodeExecutionResult> {
    if (!opts.code || opts.code.length > 8000) {
      return { ok: false, error: 'Code is required (max 8000 chars)', logs: [], toolCalls: 0 };
    }

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

          if (toolCalls >= MAX_TOOL_CALLS) {
            child.send({ type: 'toolResult', id, error: `Tool call budget exceeded (max ${MAX_TOOL_CALLS})` });
            return;
          }
          if (BLOCKED_TOOLS.has(name)) {
            child.send({ type: 'toolResult', id, error: `Tool ${name} cannot be called from custom logic` });
            return;
          }
          const tool = getToolByName(name);
          if (!tool) {
            child.send({ type: 'toolResult', id, error: `Unknown tool ${name}` });
            return;
          }
          const tier = tool.riskTier ?? (tool.riskLevel === 'high' ? 3 : tool.riskLevel === 'medium' ? 2 : 1);
          if (tier > 2) {
            child.send({ type: 'toolResult', id, error: `Tool ${name} is tier ${tier} — custom logic may only call tier 1-2 tools` });
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
