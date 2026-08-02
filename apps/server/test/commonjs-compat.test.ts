/**
 * The server must be able to `require()` every package it imports.
 *
 * This exists because the server could not boot AT ALL and nothing caught it.
 * `node dist/main.js` died with ERR_REQUIRE_ESM before NestFactory ever ran:
 * uuid@14 is ESM-only ("type": "module", no CJS export), tsconfig emits
 * CommonJS, and Node is pinned below 20.19 so `require(esm)` is unavailable.
 *
 * 2217 unit tests were green at the time. None of them boot the app, and vitest
 * resolves ESM natively, so the entire suite was blind to it by construction —
 * the one failure mode that makes every other test meaningless.
 *
 * This check is static: it reads the dependency manifests rather than booting,
 * so it is fast, needs no database, and fails with the offending package named.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SERVER_ROOT = join(__dirname, '..');
const SRC = join(SERVER_ROOT, 'src');

/**
 * Collect every .ts file that is actually COMPILED into the runtime bundle.
 *
 * Spec files are excluded, matching tsconfig's own
 * `"exclude": [..., "**\/*.spec.ts", "**\/*.test.ts"]`. They never reach
 * dist/, and they run under vitest, which resolves ESM natively — so an
 * ESM-only devDependency imported by a spec is correct and must not fail this
 * check. Scanning them anyway would flag @golevelup/ts-vitest and train the
 * next person to disable the test.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      walk(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !/\.(spec|test)\.ts$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Bare package specifiers imported by the server, normalised to package names. */
function importedPackages(): Set<string> {
  const packages = new Set<string>();
  const pattern = /(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g;

  for (const file of walk(SRC)) {
    // Type-only imports are erased at compile time and never reach require().
    const src = readFileSync(file, 'utf8').replace(/^\s*import\s+type\s.*$/gm, '');
    for (const match of src.matchAll(pattern)) {
      const spec = match[1];
      if (spec.startsWith('.') || spec.startsWith('node:')) continue;
      const parts = spec.split('/');
      packages.add(spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
    }
  }
  return packages;
}

/** Resolve a package's own package.json without importing the package itself. */
function manifestOf(name: string): Record<string, unknown> | null {
  try {
    // resolve the manifest directly — some ESM-only packages cannot be
    // require()'d at all, which is the very thing being detected.
    const entry = require.resolve(`${name}/package.json`, { paths: [SERVER_ROOT] });
    return JSON.parse(readFileSync(entry, 'utf8')) as Record<string, unknown>;
  } catch {
    try {
      const entry = require.resolve(name, { paths: [SERVER_ROOT] });
      let dir = dirname(entry);
      for (let i = 0; i < 8; i++) {
        const candidate = join(dir, 'package.json');
        if (existsSync(candidate)) {
          return JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, unknown>;
        }
        dir = dirname(dir);
      }
    } catch {
      /* not installed / not resolvable — not this test's concern */
    }
    return null;
  }
}

/**
 * A package is require()-able if it is not type:module, or if it still exposes a
 * CommonJS entry via `main` or a `require` condition in `exports`.
 */
function isRequireable(manifest: Record<string, unknown>): boolean {
  if (manifest.type !== 'module') return true;

  const exports = manifest.exports as unknown;
  if (typeof exports === 'object' && exports !== null) {
    const json = JSON.stringify(exports);
    if (json.includes('"require"')) return true;
  }
  // `main` on a type:module package still points at ESM unless exports says
  // otherwise, so main alone is not sufficient evidence.
  return false;
}

describe('CommonJS compatibility of server dependencies', () => {
  it('compiles to CommonJS — the premise of this whole check', () => {
    const tsconfig = readFileSync(join(SERVER_ROOT, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toMatch(/"module"\s*:\s*"CommonJS"/i);
  });

  it('every imported package can be require()d', () => {
    const offenders: string[] = [];

    for (const name of [...importedPackages()].sort()) {
      const manifest = manifestOf(name);
      if (!manifest) continue; // unresolvable here (types-only, optional peer)
      if (!isRequireable(manifest)) {
        offenders.push(`${name}@${String(manifest.version ?? '?')}`);
      }
    }

    // Fails naming the exact package, so the fix is obvious: pin a CJS-shipping
    // major, or replace it (uuid -> node:crypto randomUUID).
    expect(offenders).toEqual([]);
  });

  it('does not import the ESM-only uuid package', () => {
    // Specific guard for the regression that took the server down. node:crypto's
    // randomUUID is a drop-in for the bare uuidv4() call sites this repo uses.
    const importers = walk(SRC).filter((f) =>
      /(?:from|require\()\s*['"]uuid['"]/.test(readFileSync(f, 'utf8')),
    );
    expect(importers).toEqual([]);
  });
});
