/**
 * P302 DEP-CRIT-WEB-RUNTIME (D-331, D-332): the web runtime carries no dependency with a critical advisory open.
 * Dependabot (2026-11-28): next (GHSA-vcvr-r3jv-pc5j, -p293-qw3h-jr36, -673q-mjm6-r5xr, -2xp9-vwfh-vxw4,
 * -2464-fhr4-w9xw; patched in 16.4.1), jspdf (GHSA-wfv2-pwc8-crg5, -f8cm-6447-x5h2; 4.2.1), @sentry/nextjs
 * (GHSA-mchm-gjx6-7h55; 10.75.2). Both what is installed and the lowest version each declared range allows must be at
 * or above the patched version (a range a fresh install could resolve below it would reopen the advisory).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const WEB = join(__dirname, "..", "..", "..");
const ROOT = join(WEB, "..", "..");
const PATCHED: Array<[string, string, string]> = [
  // [package, patched version, the package.json that declares it]
  ["next", "16.4.1", join(WEB, "package.json")],
  ["jspdf", "4.2.1", join(WEB, "package.json")],
  ["@sentry/nextjs", "10.75.2", join(ROOT, "package.json")],
];

const parts = (v: string) => v.replace(/^[^\d]*/, "").split(/[.+-]/).slice(0, 3).map((n) => Number(n) || 0);
const atLeast = (v: string, min: string) => {
  const [a, b] = [parts(v), parts(min)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};
const declared = (pkgJson: string, name: string): string => {
  const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as Record<string, Record<string, string> | undefined>;
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? "";
};
const installed = (pkgJson: string, name: string): string => {
  const req = createRequire(pkgJson);
  return (JSON.parse(readFileSync(req.resolve(`${name}/package.json`), "utf8")) as { version: string }).version;
};

describe("P302: no critical advisory open in the web runtime's dependencies", () => {
  for (const [name, patched, pkgJson] of PATCHED) {
    it(`${name}: the declared range starts at or above ${patched}`, () => {
      const range = declared(pkgJson, name);
      expect(range, `${name} is not declared where it was`).not.toBe("");
      expect(atLeast(range, patched), `${name} is declared as "${range}", which allows a version below ${patched}`).toBe(true);
    });
    it(`${name}: the installed version is at or above ${patched}`, () => {
      const version = installed(pkgJson, name);
      expect(atLeast(version, patched), `${name} ${version} is installed (below ${patched})`).toBe(true);
    });
  }
  it("the comparison itself: 16.2.4 < 16.4.1 <= 16.4.1 < 16.10.0", () => {
    expect(atLeast("16.2.4", "16.4.1")).toBe(false);
    expect(atLeast("^16.4.1", "16.4.1")).toBe(true);
    expect(atLeast("16.10.0", "16.4.1")).toBe(true);
    expect(atLeast("2.5.2", "4.2.1")).toBe(false);
  });
});
