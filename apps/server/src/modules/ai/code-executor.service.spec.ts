import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeExecutorService } from './code-executor.service';

const ENV_KEYS = ['CODE_EXECUTOR_BACKEND', 'E2B_API_KEY', 'PUBLIC_API_URL'] as const;

/**
 * SEC-KEY-CUSTOM-LOGIC (P0, D-272.4):
 * Tenant KEY's `execute_custom_logic` must NEVER execute LLM-authored JavaScript
 * in a local child process on the API host. Shadowing `process` and `require` as
 * `new Function(...)` parameters is trivially bypassed via
 * `(function(){}).constructor('return process')()`, granting arbitrary host RCE.
 *
 * Tenant custom logic runs ONLY when an isolated E2B microVM backend is configured
 * and loads cleanly — never via a local host process or a silent fallback to local.
 */
describe('CodeExecutorService (SEC-KEY-CUSTOM-LOGIC, P0, D-272.4)', () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  let service: CodeExecutorService;

  const HOST_ESCAPE_PAYLOAD = `
    const hostProcess = (function () {}).constructor('return process')();
    const hostFs = hostProcess.mainModule?.require?.('fs');
    return {
      pid: hostProcess.pid,
      ppid: hostProcess.ppid,
      cwd: hostProcess.cwd(),
      hasEtcHosts: Boolean(hostFs && hostFs.existsSync('/etc/hosts')),
    };
  `;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    service = new CodeExecutorService();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('SEC-CL-01 RED: with no isolated E2B sandbox configured, host-escape snippet cannot reach the API host and backend is disabled', async () => {
    const inner = vi.fn();
    const res = await service.execute({
      businessId: 'biz_test',
      code: HOST_ESCAPE_PAYLOAD,
      innerToolExecutor: inner,
    });
    expect(res.ok, JSON.stringify(res)).toBe(false);
    expect(res.value).toBeUndefined();
    expect(res.error).toMatch(/disabled|sandbox|E2B/i);
    expect(inner).not.toHaveBeenCalled();
    expect(service.backend()).toBe('disabled');
  });

  it('SEC-CL-02 RED: benign tenant JS is also refused when no isolated sandbox is configured (no local host execution)', async () => {
    const inner = vi.fn();
    const res = await service.execute({
      businessId: 'biz_test',
      code: 'return 2 + 2;',
      innerToolExecutor: inner,
    });
    expect(res.ok, JSON.stringify(res)).toBe(false);
    expect(res.value).toBeUndefined();
    expect(res.error).toMatch(/disabled|sandbox|E2B/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it('SEC-CL-03 RED: setting CODE_EXECUTOR_BACKEND=local cannot re-enable local API-host execution', async () => {
    process.env.CODE_EXECUTOR_BACKEND = 'local';
    const res = await service.execute({
      businessId: 'biz_test',
      code: HOST_ESCAPE_PAYLOAD,
      innerToolExecutor: vi.fn(),
    });
    expect(res.ok, JSON.stringify(res)).toBe(false);
    expect(res.value).toBeUndefined();
    expect(res.error).toMatch(/disabled|sandbox|E2B/i);
    expect(service.backend()).toBe('disabled');
  });

  it('SEC-CL-04 RED: E2B SDK load failure fails closed deterministically (no outbound traffic) and NEVER falls back to local host execution', async () => {
    process.env.E2B_API_KEY = 'e2b_test_key';
    process.env.PUBLIC_API_URL = 'https://api.example.test';
    expect(service.backend()).toBe('e2b');
    const loaderSpy = vi
      .spyOn(service as unknown as { loadE2bSdk: () => Promise<unknown> }, 'loadE2bSdk')
      .mockRejectedValueOnce(new Error('synthetic SDK load failure'));
    const inner = vi.fn();

    const res = await service.execute({
      businessId: 'biz_test',
      code: HOST_ESCAPE_PAYLOAD,
      innerToolExecutor: inner,
    });
    expect(loaderSpy).toHaveBeenCalledTimes(1);
    expect(res.ok, JSON.stringify(res)).toBe(false);
    expect(res.value).toBeUndefined();
    expect(res.error).toMatch(/SDK load failed/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it('SEC-CL-05: partial E2B configuration, kill-switch overrides, and non-https PUBLIC_API_URL all fail closed', async () => {
    process.env.E2B_API_KEY = 'e2b_test_key';
    expect(service.backend()).toBe('disabled');
    const r1 = await service.execute({
      businessId: 'biz_test',
      code: 'return 1;',
      innerToolExecutor: vi.fn(),
    });
    expect(r1.ok).toBe(false);

    delete process.env.E2B_API_KEY;
    process.env.PUBLIC_API_URL = 'https://api.example.test';
    expect(service.backend()).toBe('disabled');
    const r2 = await service.execute({
      businessId: 'biz_test',
      code: 'return 1;',
      innerToolExecutor: vi.fn(),
    });
    expect(r2.ok).toBe(false);

    // Forced e2b without E2B_API_KEY fails closed rather than running locally.
    process.env.CODE_EXECUTOR_BACKEND = 'e2b';
    expect(service.backend()).toBe('e2b');
    const r3 = await service.execute({
      businessId: 'biz_test',
      code: HOST_ESCAPE_PAYLOAD,
      innerToolExecutor: vi.fn(),
    });
    expect(r3.ok).toBe(false);
    expect(r3.error).toMatch(/E2B_API_KEY/i);

    // Forced e2b with E2B_API_KEY set but PUBLIC_API_URL missing also fails closed.
    process.env.E2B_API_KEY = 'e2b_test_key';
    delete process.env.PUBLIC_API_URL;
    const r4 = await service.execute({
      businessId: 'biz_test',
      code: HOST_ESCAPE_PAYLOAD,
      innerToolExecutor: vi.fn(),
    });
    expect(r4.ok).toBe(false);
    expect(r4.error).toMatch(/PUBLIC_API_URL/i);

    // Non-https PUBLIC_API_URL is refused so x-exec-token is never transmitted in plaintext.
    process.env.PUBLIC_API_URL = 'http://api.example.test';
    const r5 = await service.execute({
      businessId: 'biz_test',
      code: 'return 1;',
      innerToolExecutor: vi.fn(),
    });
    expect(r5.ok).toBe(false);
    expect(r5.error).toMatch(/https/i);

    // Kill-switch and invalid overrides beat configured E2B credentials.
    process.env.PUBLIC_API_URL = 'https://api.example.test';
    for (const override of ['disabled', 'local', '  LOCAL  ', 'unknown']) {
      process.env.CODE_EXECUTOR_BACKEND = override;
      expect(service.backend(), override).toBe('disabled');
      const blocked = await service.execute({
        businessId: 'biz_test',
        code: 'return 1;',
        innerToolExecutor: vi.fn(),
      });
      expect(blocked.ok, override).toBe(false);
      expect(blocked.error, override).toMatch(/disabled/i);
    }
  });

  it('SEC-CL-06: input validation and tool-bridge token boundary still fail closed', async () => {
    const empty = await service.execute({
      businessId: 'biz_test',
      code: '',
      innerToolExecutor: vi.fn(),
    });
    expect(empty.ok).toBe(false);
    expect(empty.error).toMatch(/Code is required/i);

    const tooLong = await service.execute({
      businessId: 'biz_test',
      code: 'a'.repeat(8001),
      innerToolExecutor: vi.fn(),
    });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error).toMatch(/max 8000 chars/i);

    const noToken = await service.handleToolBridge(undefined, { name: 'crm_list_contacts', args: {} });
    expect(noToken.error).toMatch(/Invalid or expired execution token/i);

    const badToken = await service.handleToolBridge('forged-token', { name: 'crm_list_contacts', args: {} });
    expect(badToken.error).toMatch(/Invalid or expired execution token/i);
  });
});
