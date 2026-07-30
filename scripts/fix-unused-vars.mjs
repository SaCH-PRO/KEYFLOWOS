/**
 * Dev-only helper: prefix unused identifiers with '_' based on eslint output.
 *
 * NEVER run this in production.
 */
import { readFileSync, writeFileSync } from "fs";

const lintOutput = process.argv[2];
if (!lintOutput) {
  console.error("Usage: node fix-unused-vars.mjs <path-to-lint-output>");
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
  const warnMatch = line.match(/^\s*(\d+):(\d+)\s+warning\s+'([a-zA-Z0-9_$]+)'.*@typescript-eslint\/no-unused-vars/);
  if (warnMatch && currentFile) {
    targets.push({
      file: currentFile,
      line: Number(warnMatch[1]),
      col: Number(warnMatch[2]),
      name: warnMatch[3],
    });
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
    const col = item.col - 1; // 0-based
    // Verify the identifier at the expected column.
    const expected = original.slice(col, col + item.name.length);
    if (expected !== item.name) {
      console.warn(`Column mismatch in ${file}:${item.line} (expected '${item.name}' at ${item.col}, found '${expected}')`);
      continue;
    }
    // Replace this single occurrence with a leading underscore.
    const renamed = original.slice(0, col) + "_" + item.name + original.slice(col + item.name.length);
    contentLines[idx] = renamed;
  }
  writeFileSync(file, contentLines.join("\n"));
  console.log(`Updated ${file} (${items.length} occurrences)`);
}

console.log(`Fixed ${targets.length} unused variable bindings`);
