/**
 * P262: scripts/revert-problematic-renames.mjs (dev-only) reads each file it lists and would throw on one that no
 * longer exists (P258 removed apps/web/src/app/app/expenses/components/expense-pipeline.tsx). Every listed file must
 * exist. The script is not run here: it rewrites the files it lists. Its list is read from its source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "scripts", "revert-problematic-renames.mjs"), "utf8");
const listed = [...source.matchAll(/\{\s*file:\s*"([^"]+)"/g)].map((m) => m[1]);

test("the script's list is read (the parse is not vacuous)", () => {
  // a known entry that stays, so a parse that read nothing (or the wrong thing) fails here, not silently passes below
  assert.ok(listed.includes("apps/web/src/app/app/finance/components/finance-pipeline.tsx"), `entries read: ${listed.join(", ") || "none"}`);
  assert.equal(listed.length, (source.match(/\bfile:/g) ?? []).length, "an entry was not read");
});

test("every file the script lists exists", () => {
  const missing = [...new Set(listed.filter((file) => !existsSync(join(root, file))))];
  assert.deepEqual(missing, [], `the script would throw reading: ${missing.join(", ")}`);
});
