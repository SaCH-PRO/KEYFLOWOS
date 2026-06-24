import fs from 'fs';
import path from 'path';

const root = path.resolve('.');
const clientFile = path.join(root, 'apps/web/src/lib/client.ts');
const apiDir = path.join(root, 'apps/web/src/lib/api');

const source = fs.readFileSync(clientFile, 'utf8');
const lines = source.split('\n');

// 1-based inclusive section boundaries for self-contained bottom sections.
const sections = [
  { name: 'product-cost', start: 13431, end: 13480 },
  { name: 'approvals', start: 14004, end: 14138 },
  { name: 'structure', start: 13624, end: 13777 },
  { name: 'assets', start: 14139, end: 14234 },
  { name: 'evidence', start: 14235, end: 14313 },
];

function buildImports(text) {
  const imports = [];
  if (/\bz\./.test(text)) imports.push('import { z } from "zod";');

  const apiHelpers = [];
  if (/\bapiGetSimple\b/.test(text)) apiHelpers.push('apiGet as apiGetSimple');
  if (/\bapiPostSimple\b/.test(text)) apiHelpers.push('apiPostSimple');
  if (/\bapiPost\b/.test(text)) apiHelpers.push('apiPost');
  if (/\bapiPatch\b/.test(text)) apiHelpers.push('apiPatch');
  if (/\bapiPut\b/.test(text)) apiHelpers.push('apiPut');
  if (/\bapiDelete\b/.test(text)) apiHelpers.push('apiDelete');
  if (/\bAPI_BASE\b/.test(text)) apiHelpers.push('API_BASE');
  if (/\bgetAuthHeaders\b/.test(text)) apiHelpers.push('getAuthHeaders');
  if (/\bemitUnauthorizedEvent\b/.test(text)) apiHelpers.push('emitUnauthorizedEvent');
  if (/\bPlanLimitError\b/.test(text)) apiHelpers.push('type PlanLimitError');

  if (apiHelpers.length) {
    imports.push(`import { ${apiHelpers.join(', ')} } from "../api";`);
  }
  if (/\bDEFAULT_BUSINESS_ID\b/.test(text)) {
    imports.push('import { DEFAULT_BUSINESS_ID } from "./_defaults";');
  }
  if (/\bgetStoredBusinessId\b/.test(text)) {
    imports.push('import { getStoredBusinessId } from "../workspace";');
  }
  return imports.join('\n');
}

const exportsToAdd = [];

for (const sec of sections) {
  const startIdx = sec.start - 1;
  const endIdx = sec.end;
  const sectionLines = lines.slice(startIdx, endIdx);
  const text = sectionLines.join('\n');
  const imports = buildImports(text);
  const fileContent = `${imports}\n\n${text}\n`;
  const outPath = path.join(apiDir, `${sec.name}.ts`);
  fs.writeFileSync(outPath, fileContent, 'utf8');
  exportsToAdd.push(`export * from "./api/${sec.name}";`);
  console.log(`Wrote ${outPath} (${sectionLines.length} lines)`);
}

let insertAfter = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('import ') || lines[i].startsWith('export ')) {
    insertAfter = i + 1;
  } else if (lines[i].trim() === '' && insertAfter > 0) {
    insertAfter = i + 1;
    break;
  }
}

const sorted = [...sections].sort((a, b) => b.start - a.start);
let remainingLines = [...lines];
for (const sec of sorted) {
  const startIdx = sec.start - 1;
  const endIdx = sec.end;
  remainingLines.splice(startIdx, endIdx - startIdx);
}

const exportBlock = ['', ...exportsToAdd, ''];
remainingLines.splice(insertAfter, 0, ...exportBlock);

fs.writeFileSync(clientFile, remainingLines.join('\n'), 'utf8');
console.log(`Updated ${clientFile}`);
