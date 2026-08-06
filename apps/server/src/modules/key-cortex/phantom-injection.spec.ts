/**
 * The failure that produces a service which looks wired and cannot run.
 *
 *   @Optional()
 *   @Inject(TrustExplanationService)
 *   private readonly trustExplanation?: TrustExplanationService,
 *
 * If TrustExplanationService is in no module's providers, Nest binds
 * `undefined`. @Optional() means it does NOT throw at boot. The app starts
 * clean, the call site reads as wired at every glance, and the guard in front of
 * it is false forever.
 *
 * Two services shipped this way and neither broke anything, which is the point:
 *
 *   TrustExplanationService   Phase 18F Layer 7, "every recommendation explains
 *                             itself." A real guarded call site in the query
 *                             pipeline had been false on every request since the
 *                             service was written. Registered 2026-08-06.
 *   KeyCommandRouterService   Registered nowhere, injected into
 *                             KeyCortexCommandService, field never read. Its
 *                             header claimed "ONE pathway for all commands. No
 *                             more direct Cortex execution" while the opposite
 *                             shipped. Deleted 2026-08-06.
 *
 * Without @Optional() this class of mistake is impossible — Nest refuses to
 * start and you find out in seconds. @Optional() is what converts a loud boot
 * failure into a silent permanent no-op, so every use of it needs a provider
 * that actually exists somewhere.
 *
 * This is deliberately repo-wide rather than key-cortex-only. Both instances
 * happened to live here; the mistake is a Nest one and nothing about it is
 * specific to the cortex.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);

/**
 * Every token named inside any `providers: [...]` array.
 *
 * Deliberately loose — it collects every capitalised identifier in the array
 * rather than parsing entries, so `{ provide: X, useClass: Y }` and plain `X`
 * both register. A false NEGATIVE here means a phantom slips through; a false
 * POSITIVE would mean failing a correctly-wired service, which is the outcome
 * that gets a test deleted. Erring loose is the right trade for a ratchet.
 */
function providerTokens(): Set<string> {
  const tokens = new Set<string>();

  for (const file of FILES.filter((f) => f.endsWith('.module.ts'))) {
    const src = fs.readFileSync(file, 'utf8');
    let at = src.indexOf('providers: [');

    while (at !== -1) {
      let depth = 0;
      let end = src.length;
      for (let i = at + 'providers: '.length - 1; i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']' && --depth === 0) {
          end = i;
          break;
        }
      }
      for (const m of src.slice(at, end).matchAll(/\b([A-Z]\w+)\b/g)) tokens.add(m[1]);
      at = src.indexOf('providers: [', end);
    }
  }
  return tokens;
}

describe('no @Optional() injection resolves to a provider that does not exist', () => {
  const tokens = providerTokens();

  it('found the module graph', () => {
    // If this collapses, every assertion below passes vacuously.
    expect(tokens.size).toBeGreaterThan(100);
  });

  it('every @Optional() @Inject target is registered somewhere', () => {
    const phantom: string[] = [];

    for (const file of FILES) {
      if (file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(file, 'utf8');

      for (const m of src.matchAll(/@Optional\(\)\s*@Inject\((\w+)\)/g)) {
        if (!tokens.has(m[1])) {
          phantom.push(`${m[1]} injected in ${path.relative(SRC, file).split(path.sep).join('/')}`);
        }
      }
    }

    expect(
      phantom,
      'these are @Optional()-injected but registered in no module, so Nest binds undefined ' +
        'and the call site is a permanent no-op that reads as wired. Register the provider, ' +
        'or delete the injection along with the service',
    ).toEqual([]);
  });

  it('the two known instances stay fixed', () => {
    // Named, so a regression says what it broke rather than just a class name.
    const moduleSrc = fs.readFileSync(
      path.join(SRC, 'modules', 'key-cortex', 'key-cortex.module.ts'),
      'utf8',
    );

    expect(
      tokens.has('TrustExplanationService'),
      'TrustExplanationService is unregistered again — no executed action will be explained',
    ).toBe(true);
    expect(moduleSrc).toMatch(/^\s*TrustExplanationService,\s*$/m);

    const routerFiles = FILES.filter((f) => f.includes('key-command-router'));
    expect(
      routerFiles,
      'KeyCommandRouterService is back. It was deleted because it claimed to be the single ' +
        'command pathway while being registered nowhere and read by nothing — if it returns, ' +
        'it must be registered and actually routed through',
    ).toEqual([]);
  });
});
