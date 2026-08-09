/**
 * The built server starts.
 *
 * On 2026-08-09 the merged main had: tsc clean on both apps, 3304 server tests
 * passing, 170 web tests passing, check-tool-routes 245/245, every gate green
 * — and `node dist/main.js` never reached listening. Nest could not resolve
 * KeyCortexExecutorService and threw before the first route was mapped.
 *
 * Nothing in the suite had ever imported AppModule. Every test builds the two
 * or three providers it needs by hand, which is fast and focused and says
 * nothing about whether the hundred-odd modules compose. The verification
 * apparatus was blind to "does it start", and that is not a gap another
 * assertion on the same axis would close — it is a missing instrument.
 *
 * WHAT THIS CATCHES THAT TYPECHECK CANNOT
 * ---------------------------------------
 * Nest resolves dependencies from decorator metadata at runtime. Three things
 * are invisible to tsc and fatal here:
 *
 *   - `private readonly x?: SomeService` with no @Optional(). TypeScript's `?`
 *     means nothing to Nest; it demands the provider and aborts the boot.
 *   - a circular FILE import, which leaves the class reference undefined when
 *     decorator metadata is emitted, so a REQUIRED param resolves to undefined
 *     even though its module provides and exports it.
 *   - a provider dropped from a module while its consumers still inject it.
 *
 * All three typecheck perfectly. All three stop the product from starting.
 *
 * WHY A CHILD PROCESS RATHER THAN Test.createTestingModule().compile()
 * -------------------------------------------------------------------
 * compile() was tried first and did not finish in three minutes, while the
 * real server reaches its DI error in about fifteen seconds. A gate that takes
 * longer than the thing it measures gets skipped, and one that times out
 * reports "slow" where the answer was "broken".
 *
 * Spawning the built artifact also tests what actually ships — dist, the
 * emitted decorator metadata, the real module graph — instead of a harness's
 * approximation of it.
 *
 * IT RUNS AGAINST dist/, AND CI DOES NOT BUILD IT
 * ------------------------------------------------
 * This header used to claim "in CI the build precedes the tests". That was
 * false when it was written and is still false: the `test` job
 * (ci-cd.yml:284-315) runs checkout, install, db:generate, a build of the three
 * WORKSPACE PACKAGES, db:deploy, then tests. It never builds apps/server.
 * dist/ is gitignored, `needs:` excludes build-server, and the workflow has no
 * artifact upload/download — so dist/main.js cannot exist in that job and this
 * gate fails in about 0.4s on a missing file, every run, saying nothing about
 * dependency injection.
 *
 * It has not actually run yet: the whole `test` job has been SKIPPED since
 * 2026-08-08, because lint exits 1 on 3397 warnings against a 3376 ceiling and
 * every downstream job needs it. So this is a trap already set, not one that
 * has sprung.
 *
 * Fix is one step in the test job, before the test step:
 *
 *     - name: Build server
 *       run: cd apps/server && pnpm run build
 *
 * Deliberately NOT skipped-when-missing. A gate that quietly stands down when
 * its precondition is absent is the disease this file was written to treat —
 * it would go green in CI forever while measuring nothing.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const SERVER_DIR = path.resolve(__dirname, '..');
const ENTRY = path.join(SERVER_DIR, 'dist', 'main.js');

/** A port nothing else in this repo uses, so a stray dev server cannot mask it. */
const PORT = '3994';
const BUDGET_MS = 90_000;

interface BootResult {
  started: boolean;
  /** Nest's own diagnosis, when it refused. */
  diagnosis: string | null;
  output: string;
}

/**
 * Start the built server and wait for it to either announce itself or die.
 *
 * Resolves on the first decisive signal rather than a fixed sleep: a boot that
 * is going to fail says so in seconds, and one that works says so too.
 */
function bootServer(): Promise<BootResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY], {
      cwd: SERVER_DIR,
      env: { ...process.env, PORT, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let settled = false;
    const finish = (r: Omit<BootResult, 'output'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve({ ...r, output });
    };

    const timer = setTimeout(
      () => finish({ started: false, diagnosis: `no decisive signal within ${BUDGET_MS}ms` }),
      BUDGET_MS,
    );

    const read = (buf: Buffer) => {
      // Nest's logger colours its output, so `ERROR [ExceptionHandler]` arrives
      // with escape codes wedged between the words. Matching the raw stream
      // found nothing and the gate reported a 90s timeout — "slow" where the
      // answer was "broken", which is the worst way for a gate to be wrong.
      output += buf.toString().replace(/\x1b\[[0-9;]*m/g, '');
      // Nest names the service and the argument index; that IS the diagnosis.
      const failure = output.match(
        /(UndefinedDependencyException|Nest can't resolve dependencies of the [^\n]+|ERROR \[ExceptionHandler\][^\n]+)/,
      );
      if (failure) return finish({ started: false, diagnosis: failure[0] });
      if (/Nest application successfully started|Application is running on/i.test(output)) {
        return finish({ started: true, diagnosis: null });
      }
    };

    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (e) => finish({ started: false, diagnosis: `spawn failed: ${e.message}` }));
    child.on('exit', (code) => {
      if (code !== 0) finish({ started: false, diagnosis: `exited with code ${code}` });
    });
  });
}

describe('the built server starts', () => {
  it('dist exists — build before running this', () => {
    expect(
      existsSync(ENTRY),
      'dist/main.js is missing, so the boot was never measured. ' +
        'Locally: run `pnpm build` in apps/server first. ' +
        'In CI: the test job does not build the server — add a "Build server" step ' +
        'before the test step (see this file header). This failure is a BUILD-ORDER ' +
        'problem, not a dependency-injection one: do not go hunting for a DI bug.',
    ).toBe(true);
  });

  it(
    'reaches listening instead of dying in dependency injection',
    async () => {
      const result = await bootServer();

      expect(
        result.started,
        'The server does not start. Nothing else in this suite can tell you that — ' +
          'tsc is clean and every other test passes against a build that never ' +
          `serves a request.\n\n  ${result.diagnosis}\n\n` +
          result.output.split('\n').slice(-6).join('\n'),
      ).toBe(true);
    },
    BUDGET_MS + 30_000,
  );
});
