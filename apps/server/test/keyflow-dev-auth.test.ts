import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { isDevAuthBypassEnabled } from '../src/core/auth/keyflow-dev-auth';

describe('isDevAuthBypassEnabled()', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBypass = process.env.KEYFLOW_DEV_AUTH_BYPASS;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;

    if (originalBypass === undefined) delete process.env.KEYFLOW_DEV_AUTH_BYPASS;
    else process.env.KEYFLOW_DEV_AUTH_BYPASS = originalBypass;
  });

  it('returns false in production regardless of KEYFLOW_DEV_AUTH_BYPASS=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.KEYFLOW_DEV_AUTH_BYPASS = 'true';
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it('returns false in production regardless of KEYFLOW_DEV_AUTH_BYPASS=1', () => {
    process.env.NODE_ENV = 'production';
    process.env.KEYFLOW_DEV_AUTH_BYPASS = '1';
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it('returns true in development when KEYFLOW_DEV_AUTH_BYPASS=true', () => {
    process.env.NODE_ENV = 'development';
    process.env.KEYFLOW_DEV_AUTH_BYPASS = 'true';
    expect(isDevAuthBypassEnabled()).toBe(true);
  });

  it('returns true in development when KEYFLOW_DEV_AUTH_BYPASS=1', () => {
    process.env.NODE_ENV = 'development';
    process.env.KEYFLOW_DEV_AUTH_BYPASS = '1';
    expect(isDevAuthBypassEnabled()).toBe(true);
  });

  it('returns false in development when KEYFLOW_DEV_AUTH_BYPASS is unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.KEYFLOW_DEV_AUTH_BYPASS;
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it('returns false in development when KEYFLOW_DEV_AUTH_BYPASS has a non-truthy value', () => {
    process.env.NODE_ENV = 'development';
    process.env.KEYFLOW_DEV_AUTH_BYPASS = 'false';
    expect(isDevAuthBypassEnabled()).toBe(false);
    process.env.KEYFLOW_DEV_AUTH_BYPASS = '0';
    expect(isDevAuthBypassEnabled()).toBe(false);
    process.env.KEYFLOW_DEV_AUTH_BYPASS = 'yes';
    expect(isDevAuthBypassEnabled()).toBe(false);
  });
});

describe('main.ts production bypass hard-fail (process-level smoke check)', () => {
  it('exits non-zero when started with NODE_ENV=production and KEYFLOW_DEV_AUTH_BYPASS=true', async () => {
    const serverRoot = path.resolve(__dirname, '..');
    const mainEntry = path.join(serverRoot, 'src', 'main.ts');
    const tsxBin = path.join(serverRoot, 'node_modules', '.bin', 'tsx');

    const child = spawn(tsxBin, [mainEntry], {
      cwd: serverRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        KEYFLOW_DEV_AUTH_BYPASS: 'true',
        // Use a port unlikely to collide, though the process should die before binding.
        PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const killTimer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Server process did not exit within timeout — hard-fail guard may be broken'));
        }, 20_000);

        child.on('exit', (code, signal) => {
          clearTimeout(killTimer);
          resolve({ code, signal });
        });
        child.on('error', (err) => {
          clearTimeout(killTimer);
          reject(err);
        });
      },
    );

    expect(result.code, `expected non-zero exit; stderr was:\n${stderr}`).not.toBe(0);
    expect(result.code).not.toBeNull();
    expect(stderr).toContain('KEYFLOW_DEV_AUTH_BYPASS');
  }, 30_000);
});
