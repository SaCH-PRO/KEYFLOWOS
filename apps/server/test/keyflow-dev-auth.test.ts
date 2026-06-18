import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const IS_WINDOWS = process.platform === 'win32';

describe('KEYFLOW_DEV_AUTH_BYPASS boot guard', () => {
  it('exits non-zero when set to "true"', async () => {
    const result = await runMain('true');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('KEYFLOW_DEV_AUTH_BYPASS');
  }, 120_000);

  it('exits non-zero when set to "1"', async () => {
    const result = await runMain('1');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('KEYFLOW_DEV_AUTH_BYPASS');
  }, 120_000);
});

async function runMain(value: string): Promise<{ code: number | null; stderr: string }> {
  const serverRoot = path.resolve(__dirname, '..');
  const mainEntry = path.join(serverRoot, 'src', 'main.ts');
  // On Windows, .bin contains tsx.CMD (PATHEXT handles the extension);
  // on Unix it's a shell script with no extension.
  const tsxBin = path.join(serverRoot, 'node_modules', '.bin', IS_WINDOWS ? 'tsx.CMD' : 'tsx');

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
      // SIGKILL is not supported on Windows; default kill() terminates the process tree.
      child.kill(IS_WINDOWS ? undefined : 'SIGKILL');
      reject(new Error('main.ts did not exit within timeout'));
    }, 100_000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stderr }); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}
