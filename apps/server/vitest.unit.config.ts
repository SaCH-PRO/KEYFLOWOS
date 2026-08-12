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
  },
});
