/**
 * Dev-only helper: rename unused caught error identifiers from `err`/`error`
 * to `_err`/`_error` based on eslint output.
 *
 * NEVER run this in production.
 */
import { readFileSync, writeFileSync } from "fs";

const lintOutput = process.argv[2];
if (!lintOutput) {
  console.error("Usage: node fix-unused-caught-errors.mjs <path-to-lint-output>");
  process.exit(1);
}

const text = readFileSync(lintOutput, "utf8");
const lines = text.split("\n");

const targets = [];
let currentFile = "";
for (const line of lines) {
  const fileMatch = line.match(/^(C:[\\\/](?:[^\\\n]+[\\\/])+[^\\\n]+\.(?:tsx?|jsx?))$/);
  if (fileMatch) {
    currentFile = fileMatch[1].replace(/\\/g, "/");
    continue;
  }
  const warnMatch = line.match(/^\s*(\d+):(\d+)\s+warning\s+'([a-zA-Z0-9_$]+)'.*caught errors/);
  if (warnMatch && currentFile) {
    targets.push({ file: currentFile, line: Number(warnMatch[1]), name: warnMatch[3] });
  }
}

const byFile = new Map();
for (const t of targets) {
  if (!byFile.has(t.file)) byFile.set(t.file, []);
  byFile.get(t.file).push(t);
}

for (const [file, items] of byFile) {
  const content = readFileSync(file, "utf8");
  const contentLines = content.split("\n");
  for (const item of items) {
    const idx = item.line - 1;
    const original = contentLines[idx];
    // Rename the caught error binding in the catch clause on this line.
    const renamed = original.replace(
      new RegExp(`catch\\s*\\(\\s*${item.name}\\s*\\)`),
      `catch (_${item.name})`
    );
    if (renamed === original) {
      console.warn(`Could not rename in ${file}:${item.line}`);
    } else {
      contentLines[idx] = renamed;
    }
  }
  writeFileSync(file, contentLines.join("\n"));
  console.log(`Updated ${file} (${items.length} occurrences)`);
}

console.log(`Fixed ${targets.length} unused caught error bindings`);
