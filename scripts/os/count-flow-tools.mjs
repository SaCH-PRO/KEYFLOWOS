// KEY tool count, parsed from FLOW_TOOLS in flow-tool-registry.ts.
// VERIFIED_STATE rule 1: parse `name:` out of the registry, do NOT grep-count
// — nested schema objects also carry `name:` keys, and a naive grep once
// reported invented numbers. A tool's `name:` sits at object depth 2 relative
// to the FLOW_TOOLS array (array = depth 1, tool object = depth 2).
//
// Prints the count. Exit 1 below the vacuity floor of 100.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractInitializer } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = 'apps/server/src/modules/ai/flow-tool-registry.ts';

const src = readFileSync(resolve(ROOT, REGISTRY), 'utf8');
const init = extractInitializer(src, 'FLOW_TOOLS');

let depth = 0;
let state = 'code';
let count = 0;
for (let i = 0; i < init.length; i++) {
  const c = init[i];
  if (state !== 'code') {
    if (c === '\\') { i++; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
    continue;
  }
  if (c === "'") { state = 'sq'; continue; }
  if (c === '"') { state = 'dq'; continue; }
  if (c === '`') { state = 'tpl'; continue; }
  if (c === '(' || c === '[' || c === '{') { depth++; continue; }
  if (c === ')' || c === ']' || c === '}') { depth--; continue; }
  if (depth === 2 && c === 'n' && init.startsWith('name', i)) {
    const before = init.slice(Math.max(0, i - 2), i);
    const after = init.slice(i + 4, i + 6);
    if (/(^|[\s,{])$/.test(before) && /^\s*:/.test(after)) count++;
    i += 3;
  }
}

if (count < 100) {
  console.error(`count-flow-tools: parsed ${count} tools (< 100 floor) — the reader is blind`);
  process.exit(1);
}
console.log(count);
