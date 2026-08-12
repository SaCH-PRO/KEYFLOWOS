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
 * storefront-intelligence.service.spec.ts fail — and they fail with isolation
 * ON as well, differently on each run. Both pass alone. So two spec files
 * depend on execution order and pass today only because the default order
 * happens to suit them. That is worth fixing on its own merits; it is not a
 * reason to keep a 25:1 collect ratio.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    globals: true,
    environment: 'node',
    // Measured: 232s -> 92s. See the note above for what it trades away.
    isolate: false,
  },
});
