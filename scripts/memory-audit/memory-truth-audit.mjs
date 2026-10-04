#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, 'scripts/memory-audit/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sql', '.prisma', '.json', '.md', '.yml', '.yaml']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '.git']);

function walk(absPath) {
  const out = [];
  if (!fs.existsSync(absPath)) return out;
  const stat = fs.statSync(absPath);
  if (stat.isFile()) return [absPath];
  for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
    const child = path.join(absPath, entry.name);
    if (entry.isDirectory()) out.push(...walk(child));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(child);
  }
  return out;
}

const files = [...new Set(manifest.roots.flatMap((r) => walk(path.join(repoRoot, r))))];
const textByFile = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const rel = (f) => path.relative(repoRoot, f).replaceAll('\\\\', '/');

function countMatches(text, regex) {
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
  return [...text.matchAll(new RegExp(regex.source, flags))].length;
}

function escapedSymbol(symbol) {
  return symbol.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

function classifyComponent(component, externalRefs) {
  if (!fs.existsSync(path.join(repoRoot, component.path))) return 'BROKEN';
  if (externalRefs === 0) return 'DORMANT';
  return 'UNKNOWN_PENDING_PROOF';
}

const componentResults = manifest.components.map((component) => {
  const abs = path.join(repoRoot, component.path);
  const exists = fs.existsSync(abs);
  const body = exists ? fs.readFileSync(abs, 'utf8') : '';
  const symbol = escapedSymbol(component.symbol);
  const symbolRegex = new RegExp('\\\\b' + symbol + '\\\\b', 'g');
  const definitionRegex = new RegExp('\\\\b(class|const|function|interface|type)\\\\s+' + symbol + '\\\\b');
  const symbolPresent = exists && (definitionRegex.test(body) || symbolRegex.test(body));

  const references = [];
  if (symbolPresent) {
    for (const [file, text] of textByFile.entries()) {
      if (rel(file) === component.path) continue;
      const count = countMatches(text, symbolRegex);
      if (count > 0) references.push({ file: rel(file), count });
    }
  }

  const externalRefs = references.reduce((sum, r) => sum + r.count, 0);
  const schedulerMarkers = exists ? countMatches(body, /@(Cron|Interval|Timeout)\\b|setInterval\\s*\\(|setTimeout\\s*\\(/g) : 0;
  const persistenceMarkers = exists
    ? countMatches(body, /\\b(db|prisma|redis|aiMemory|GenomeMemory|CognitionMemory|TemporalFlow|embedding|vector)\\b/gi)
    : 0;

  return {
    name: component.name,
    path: component.path,
    required: !!component.required,
    exists,
    symbolPresent,
    externalRefs,
    references: references.slice(0, 20),
    schedulerMarkers,
    persistenceMarkers,
    classification: exists && symbolPresent ? classifyComponent(component, externalRefs) : 'BROKEN'
  };
});

const probeResults = manifest.methodProbes.map((probe) => {
  const regex = new RegExp(probe.regex, 'g');
  const matches = [];
  for (const [file, text] of textByFile.entries()) {
    if (rel(file) === probe.definitionFile) continue;
    const count = countMatches(text, regex);
    if (count > 0) matches.push({ file: rel(file), count });
  }
  const total = matches.reduce((sum, r) => sum + r.count, 0);
  const passes = total >= probe.minimumExternalMatches;
  return {
    id: probe.id,
    definitionFile: probe.definitionFile,
    minimumExternalMatches: probe.minimumExternalMatches,
    allowMissing: !!probe.allowMissing,
    externalMatches: total,
    matches: matches.slice(0, 20),
    status: passes ? 'PROVEN_STATIC_CALLSITE' : (probe.allowMissing ? 'DORMANT_CANDIDATE' : 'MISSING_REQUIRED_CALLSITE')
  };
});

const failures = [];
for (const component of componentResults) {
  if (component.required && (!component.exists || !component.symbolPresent)) {
    failures.push('required component missing or malformed: ' + component.name + ' (' + component.path + ')');
  }
}
for (const probe of probeResults) {
  if (!probe.allowMissing && probe.status === 'MISSING_REQUIRED_CALLSITE') {
    failures.push('required callsite not found: ' + probe.id);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  schemaVersion: manifest.schemaVersion,
  repositoryRoot: '.',
  scannedFiles: files.length,
  interpretation: {
    UNKNOWN_PENDING_PROOF: 'Static evidence exists, but end-to-end runtime liveness is not yet proven.',
    DORMANT: 'Definition exists but no external symbol reference was found by this audit.',
    BROKEN: 'Required definition/file is absent or the declared symbol is not present.'
  },
  components: componentResults,
  probes: probeResults,
  failures
};

const outDir = path.join(repoRoot, '.proof');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'memory-truth-audit.json');
fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\\n');

console.log('Memory truth audit: ' + componentResults.length + ' components, ' + probeResults.length + ' probes, ' + files.length + ' files scanned.');
for (const row of componentResults) {
  console.log(row.classification.padEnd(22) + ' ' + row.name.padEnd(34) + ' refs=' + String(row.externalRefs).padStart(3) + ' sched=' + row.schedulerMarkers + ' persist=' + row.persistenceMarkers);
}
for (const probe of probeResults) {
  console.log(probe.status.padEnd(24) + ' ' + probe.id + ' matches=' + probe.externalMatches);
}
console.log('Report: ' + path.relative(repoRoot, outFile));

if (failures.length > 0) {
  console.error('\\nFAILURES');
  for (const failure of failures) console.error('- ' + failure);
  process.exitCode = 1;
}
