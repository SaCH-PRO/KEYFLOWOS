#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_PATTERNS = [
  ['model_gateway', /\bModelGatewayService\b/],
  ['ai_usage', /\bAiUsageService\b/],
  ['openai_sdk', /from ['"]openai['"]|require\(['"]openai['"]\)/],
  ['anthropic_api', /api\.anthropic\.com|ANTHROPIC_API_KEY/],
  ['xai_api', /api\.x\.ai|XAI_API_KEY/],
  ['kimi_api', /api\.moonshot\.(?:cn|ai)|KIMI_API_KEY/],
  ['google_ai_api', /generativelanguage\.googleapis\.com|GEMINI_API_KEY|GOOGLE_API_KEY/],
  ['openrouter', /openrouter\.ai|OPENROUTER_API_KEY/],
  ['ollama', /OLLAMA_BASE_URL|\bollama\b/i],
  ['native_ai', /KEYFLOW_NATIVE_AI_URL|NATIVE_AI_BASE_URL|NATIVE_AI_API_KEY/],
];

const DIRECT_PROVIDER_PATTERNS = [
  /from ['"]openai['"]|require\(['"]openai['"]\)/,
  /api\.anthropic\.com/,
  /api\.x\.ai/,
  /api\.moonshot\.(?:cn|ai)/,
  /generativelanguage\.googleapis\.com/,
  /openrouter\.ai/,
];

const REASONING_HINTS = [
  /\breason(?:ing|MultiModal)?\b/i,
  /\btriage\b/i,
  /\bclassif(?:y|ier|ication)\b/i,
  /\bscore\b/i,
  /\brank\b/i,
  /\bdetect\b/i,
  /\bplan\b/i,
  /\bdecision\b/i,
  /\bheuristic\b/i,
];

export function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name) && !/\.spec\.|\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

export function classifySource(file, source, repoRoot = process.cwd()) {
  const evidence = MODEL_PATTERNS
    .filter(([, re]) => re.test(source))
    .map(([kind]) => kind);

  const directProvider = DIRECT_PROVIDER_PATTERNS.some((re) => re.test(source));
  const viaGateway = /\bModelGatewayService\b|\bAiUsageService\b/.test(source);
  const cognitiveHint = REASONING_HINTS.some((re) => re.test(source));
  const relative = path.relative(repoRoot, file).replaceAll(path.sep, '/');

  let dependency = 'NO_DETECTED_MODEL_DEPENDENCY';
  let confidence = 'MEDIUM';
  if (directProvider) {
    dependency = 'DIRECT_PROVIDER_DEPENDENCY';
    confidence = 'HIGH';
  } else if (viaGateway) {
    dependency = 'GATEWAY_MODEL_DEPENDENCY';
    confidence = 'HIGH';
  } else if (!cognitiveHint) {
    confidence = 'LOW';
  }

  return {
    path: relative,
    dependency,
    confidence,
    evidence,
    cognitiveHint,
    note:
      dependency === 'NO_DETECTED_MODEL_DEPENDENCY'
        ? 'Heuristic only: no recognized model/provider dependency was found in this file. Reachability and transitive calls require separate proof.'
        : undefined,
  };
}

export function scanRepository(repoRoot = process.cwd()) {
  const roots = [
    path.join(repoRoot, 'apps/server/src/modules/key-cortex'),
    path.join(repoRoot, 'apps/server/src/modules/ai'),
  ];
  const rows = roots.flatMap(walk).map((file) =>
    classifySource(file, fs.readFileSync(file, 'utf8'), repoRoot),
  );

  const counts = rows.reduce((acc, row) => {
    acc[row.dependency] = (acc[row.dependency] || 0) + 1;
    return acc;
  }, {});

  const likelyNativeCandidates = rows.filter(
    (row) =>
      row.dependency === 'NO_DETECTED_MODEL_DEPENDENCY' &&
      row.cognitiveHint &&
      row.confidence === 'MEDIUM',
  );

  return {
    schema: 'key-native-capacity/cognitive-dependency-scan-v0',
    generatedAt: new Date().toISOString(),
    scope: roots.map((r) => path.relative(repoRoot, r).replaceAll(path.sep, '/')),
    disclaimer:
      'Static heuristic inventory. NO_DETECTED_MODEL_DEPENDENCY is not proof of model independence or runtime reachability.',
    counts,
    rows,
    likelyNativeCandidates,
  };
}

function main() {
  const outPath = process.argv[2] || 'artifacts/key-native-capacity/cognitive-dependency.json';
  const result = scanRepository(process.cwd());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ outPath, counts: result.counts, candidates: result.likelyNativeCandidates.length }) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
