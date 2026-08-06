/**
 * A service that was written, injected, and never registered.
 *
 * TrustExplanationService is Phase 18F Layer 7 — "every recommendation explains
 * itself." It was authored in full (reasoning, evidence, risks, genome facts,
 * knowledge gaps, cost of inaction, what gets tracked), imported into two hot
 * services, and injected into both constructors.
 *
 * It was never added to key-cortex.module.ts.
 *
 * Because both injections are @Optional(), Nest bound `undefined` instead of
 * throwing at boot. The app started clean. The guard in the query pipeline —
 *
 *   if (this.trustExplanation && executedActions.length > 0)
 *
 * — was therefore false on every request the product has ever served, and no
 * explanation was produced for any executed action. Nothing failed. Nothing
 * logged. The call site reads as wired at a glance, which is why it survived.
 *
 * This is the more dangerous shape of dead code: an unregistered provider that
 * is @Optional()-injected fails SILENTLY at boot. A genuinely unreferenced
 * service at least shows up as unreferenced.
 *
 * Two other services in this module have the same shape. KeyCommandRouterService
 * is unregistered and @Optional()-injected into KeyCortexCommandService, where
 * the field is never read at all — its file header claims "ONE pathway for all
 * commands. No more direct Cortex execution," and the opposite ships.
 * KeyCortexKeystoreAdapterService is in no module and has no caller. Both are
 * tracked in docs/CAPABILITY_MAP.md rather than fixed here; deleting or wiring
 * them is a decision, not a repair.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MODULE_DIR = __dirname;
const moduleSrc = () =>
  fs.readFileSync(path.join(MODULE_DIR, 'key-cortex.module.ts'), 'utf8');

/**
 * The providers array, isolated. `exports` also lists services, and a service
 * that is exported but not provided is still undefined at injection time — so
 * matching the whole file would pass on exactly the bug this guards.
 */
function providersBlock(): string {
  const src = moduleSrc();
  const start = src.indexOf('providers: [');
  expect(start, 'providers array not found — the module was restructured').toBeGreaterThan(-1);

  const exportsAt = src.indexOf('exports: [', start);
  expect(exportsAt, 'exports array not found — the module was restructured').toBeGreaterThan(start);

  return src.slice(start, exportsAt);
}

describe('TrustExplanationService is actually wired', () => {
  it('is registered as a provider, not merely imported', () => {
    // The precise failure: the import existed for neither of the two consumers
    // to resolve against. An import statement is not a registration.
    expect(
      /^\s*TrustExplanationService,\s*$/m.test(providersBlock()),
      'TrustExplanationService is not in the providers array — both @Optional() ' +
        'injections will bind undefined and no explanation will ever be produced',
    ).toBe(true);
  });

  it('constructs with no arguments, so registering it cannot fail at boot', () => {
    // Why this fix is one line and not a dependency graph problem: the service
    // is pure. If it ever grows a constructor, registering it stops being safe
    // and this test says so before production does.
    const src = fs.readFileSync(path.join(MODULE_DIR, 'trust-explanation.service.ts'), 'utf8');
    const body = src.slice(src.indexOf('export class TrustExplanationService'));

    expect(
      /^\s*constructor\s*\(/m.test(body),
      'TrustExplanationService grew a constructor — verify its dependencies are ' +
        'provided in key-cortex.module.ts before trusting this registration',
    ).toBe(false);
  });

  it('still has a call site that consumes it', () => {
    // Registration is pointless if the guard it feeds was deleted. This asserts
    // the fix has an effect rather than just satisfying the assertion above.
    const pipeline = fs.readFileSync(
      path.join(MODULE_DIR, 'key-cortex-query-pipeline.service.ts'),
      'utf8',
    );

    expect(
      /if\s*\(\s*this\.trustExplanation\s*&&/.test(pipeline),
      'the guarded call site in the query pipeline is gone — either restore it ' +
        'or drop the provider, but do not keep a registration nothing reads',
    ).toBe(true);
    expect(pipeline).toMatch(/this\.trustExplanation\s+as\s+any\)?\s*\)?\.explain\(|\.explain\(/);
  });
});
