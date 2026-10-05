#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const depPath = process.argv[2] || 'artifacts/key-native-capacity/cognitive-dependency.json';
const motifPath = process.argv[3] || 'artifacts/key-native-capacity/procedure-motifs.json';
const outPath = process.argv[4] || 'artifacts/key-native-capacity/report.md';

const dep = readJson(depPath);
const motifs = readJson(motifPath);

const counts = dep.counts || {};
const total = dep.rows?.length || 0;
const nativeCandidates = dep.likelyNativeCandidates || [];
const direct = dep.rows?.filter((r) => r.dependency === 'DIRECT_PROVIDER_DEPENDENCY') || [];

const lines = [
  '# KEY Native Capacity Shadow Report',
  '',
  '> Derived, read-only evidence. This report is not authority and does not activate procedures.',
  '',
  '## Cognitive dependency inventory',
  '',
  `Scanned files: **${total}**`,
  `Gateway model dependency: **${counts.GATEWAY_MODEL_DEPENDENCY || 0}**`,
  `Direct provider dependency: **${counts.DIRECT_PROVIDER_DEPENDENCY || 0}**`,
  `No detected model dependency: **${counts.NO_DETECTED_MODEL_DEPENDENCY || 0}**`,
  `Likely native-cognition candidates (heuristic): **${nativeCandidates.length}**`,
  '',
  'No-detected-model-dependency is not proof of runtime independence. Reachability and transitive dependencies must be proven separately.',
  '',
  '## Direct-provider evidence',
  '',
  ...(direct.length ? direct.map((r) => `- \`${r.path}\`: ${r.evidence.join(', ')}`) : ['- None detected in scanned scope.']),
  '',
  '## Native-capacity candidates',
  '',
  ...nativeCandidates.slice(0, 30).map((r) => `- \`${r.path}\` — evidence confidence: ${r.confidence}`),
  '',
  '## Repeated control motifs',
  '',
  `Candidate motifs: **${motifs.candidates?.length || 0}**`,
  '',
  ...(motifs.candidates || []).slice(0, 30).map((m) =>
    `- ${m.sequence.join(' -> ')} — count ${m.count}; packets: ${m.packetIds.join(', ')}`
  ),
  '',
  '## Non-negotiable interpretation',
  '',
  '- observation != authority',
  '- candidate != procedure',
  '- procedure != permission',
  '- repetition != verification',
  '- routing preference != truth',
  '- this report cannot change repository, production, provider, or programme state',
  '',
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n') + '\n');
console.log(outPath);
