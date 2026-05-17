import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const IS_WINDOWS = process.platform === 'win32';

describe('KEYFLOW_DEV_AUTH_BYPASS boot guard', () => {
  (IS_WINDOWS ? it.skip : it)('exits non-zero when set to "true"', async () => {
    const result = await runMain('true');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('KEYFLOW_DEV_AUTH_BYPASS');
  }, 45_000);

  (IS_WINDOWS ? it.skip : it)('exits non-zero when set to "1"', async () => {
    const result = await runMain('1');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('KEYFLOW_DEV_AUTH_BYPASS');
  }, 45_000);
});

async function runMain(value: string): Promise<{ code: number | null; stderr: string }> {
  const serverRoot = path.resolve(__dirname, '..');
  const mainEntry = path.join(serverRoot, 'src', 'main.ts');
  const tsxBin = path.join(serverRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.CMD' : 'tsx');

  const child = spawn(tsxBin, [mainEntry], {
    cwd: serverRoot,
    env: { ...process.env, PORT: '19999', KEYFLOW_DEV_AUTH_BYPASS: value },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdout.on('data', () => {});

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('main.ts did not exit within timeout'));
    }, 35_000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stderr }); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}
