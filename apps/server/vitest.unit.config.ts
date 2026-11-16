import { defineConfig } from 'vitest/config';

/**
 * Unit suite. 2.5x faster than it was, and the number came from measuring
 * rather than from the usual advice.
 *
 * WHERE THE TIME WENT. Baseline on this tree: 232s wall, of which `collect`
 * was 1,134s aggregate and the tests themselves were 45s. Twenty-five to one.
 * Nothing here was slow because of what it asserted; it was slow because 344
 * files each rebuilt a module graph from scratch, and this codebase has two
 * source files over 275KB in it.
 *
 * MEASURED, ALL THREE:
 *
 *   forks + isolate (baseline)   232s   collect 1,134s
 *   pool: 'threads'              452s   collect 2,422s   <- 2x WORSE
 *   forks + isolate: false        92s   collect   370s   <- adopted
 *
 * `pool: 'threads'` is the optimisation everyone reaches for first and it is
 * twice as slow here. Recorded so the next person does not spend an evening
 * rediscovering it on 8 cores and Windows.
 *
 * WHAT isolate:false COSTS. Files in the same worker share a module registry,
 * so module-level state carries between them. That is a real risk in a codebase
 * with caches and singletons, and it is the reason this is NOT set on
 * vitest.integration.config.ts, where suites also share a live Postgres and
 * isolation is doing more work.
 *
 * The evidence it is safe here is narrow and worth stating precisely: 344 files
 * and 3,320 tests pass under it in the normal, deterministic file order. That
 * is not proof against leakage — it is the same evidence the suite had before,
 * plus a faster run.
 *
 * A SEPARATE, PRE-EXISTING DEFECT, found while testing this and NOT caused by
 * it: under `sequence.shuffle`, calendar.controller.spec.ts and
 * storefront-intelligence.service.spec.ts failed — with isolation ON as well,
 * differently on each run, both passing alone. Both are now fixed, and both had
 * the same shape: an assertion that read as being about behaviour but was really
 * about what had run before it.
 *
 *   calendar    — three fixture events seeded once in beforeAll, and a later
 *                 test soft-deletes one. `toHaveLength(3)` meant "the delete
 *                 test has not run yet". Now reseeded per test.
 *   storefront  — a module-level gateway spy shared by every test, one of which
 *                 calls it. `not.toHaveBeenCalled()` meant "that test has not
 *                 run yet". Now cleared per test.
 *
 * SHUFFLE IS ON, which is what stops that class coming back. Five consecutive
 * full runs pass. It is not proof — a shuffle only samples orderings — but a
 * new order dependence now surfaces as a red build instead of waiting for the
 * file order to change underneath it.
 *
 * A shuffled failure is reproducible: vitest prints `Running tests with seed
 * "<n>"`, and `--sequence.seed=<n>` replays that exact order. Quote the seed
 * when reporting one, or the next person cannot see what you saw.
 *
 * WHAT isolate:false DOES TO vi.mock (FU-UNIT-MOCK-ISOLATION). Mocks are kept
 * per file, but the module registry is not: a spec's vi.mock binds only the
 * modules evaluated after it. If an earlier file in the same worker imported
 * the service under test, the spec's import returns that copy, bound to the
 * real dependency, and the mock never applies. ai-usage.service.spec.ts's
 * `openai` mock missed this way and six cases called the real OpenAI SDK;
 * supabase-auth.service.provider.spec.ts's createClient mock missed too, and
 * two of its cases passed only because the real request failed. A spec whose
 * mock must reach a dependency of a service other files import (a provider
 * SDK under a service) resets the registry before its imports
 * (`vi.hoisted(() => vi.resetModules())`, hoisted with its vi.mock calls) and
 * after its last test (`afterAll(() => vi.resetModules())`), so it neither
 * inherits another file's copy nor leaves its mocked copy to the next file.
 * Replay: `--poolOptions.forks.singleFork --sequence.seed=2` over
 * supabase-auth.service{,.provider}.spec.ts and ai-usage{-feature-coverage,
 * .service}.spec.ts failed those 11 cases before the reset.
 *
 * NO NETWORK. test/unit.setup.js installs test/helpers/unit-network-guard.js
 * before every spec: a request to a host that is not loopback (fetch, http(s),
 * any socket) is refused before anything is resolved or sent, and the test
 * that made it fails even if the code under test swallowed the error. A mock
 * that misses now fails loudly instead of calling a provider. A loopback
 * proxy is no way round it: the guard takes the proxy variables out of the
 * worker's environment, refuses the ports they named, and refuses a CONNECT
 * or proxy-form request line naming a host outside loopback on any loopback
 * socket. unit-network-guard.spec.ts proves it. Only this config has the
 * guard: test:ci (vitest.config.ts) and the proof runners do not.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    globals: true,
    environment: 'node',
    // Measured: 232s -> 92s. See the note above for what it trades away.
    isolate: false,
    // Catches the class of bug fixed above: a test that passes only because of
    // what ran before it. See the note on reproducing a failure by seed.
    sequence: { shuffle: true },
    // Refuses outbound network in every unit spec. See NO NETWORK above.
    setupFiles: ['./test/unit.setup.js'],
    // Tells a spec it runs under this config (unit-network-guard.spec.ts checks
    // that the guard is already in place when a spec module loads).
    env: { VITEST_KEYFLOW_UNIT: '1' },
  },
});
