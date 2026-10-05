#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDag } from '../agent-control/lib/dag.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_REF = 'origin/docs/keyflow-intelligence-foundation';
const EXEC_ROOT = 'docs/intelligence/execution';
const OUT = path.join(ROOT, 'architecture/atlas/generated/packet-semantic-index.json');
const INTEL = path.join(ROOT, 'architecture/atlas/generated/intelligence-topology.json');

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 33554432 });
  if (r.status !== 0) throw new Error('atlas packet index git failure: ' + String(r.stderr || '').trim());
  return r.stdout;
}
function gitShow(ref, file) { return git(['show', ref + ':' + file]); }
function listFiles(ref) {
  return git(['ls-tree', '-r', '--name-only', ref, EXEC_ROOT]).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}
function ids(text, prefix) {
  const out = new Set();
  const re = new RegExp('\\b' + prefix + '(\\d{1,3})\\b', 'g');
  for (const m of String(text || '').matchAll(re)) out.add((prefix === 'J' ? 'KF-JOURNEY-' : 'KF-KERNEL-') + String(Number(m[1])).padStart(3, '0'));
  return [...out];
}

export function parsePacketSemantics(text) {
  const src = String(text);
  const kLine = src.match(/^Primary kernels:\s*(.+)$/mi);
  const jLine = src.match(/^Primary journeys:\s*(.+)$/mi);
  const kernelText = kLine?.[1] || '';
  const primary_kernels = ids(kernelText, 'K');
  const kernel_scope = /\ball\b/i.test(kernelText) ? 'ALL' : null;
  let primary_journeys = [];
  let consumer_journeys = [];
  let journey_scope = null;
  if (jLine) {
    const parts = jLine[1].split(';');
    const primaryText = parts.shift() || '';
    if (/^\s*all\s+constellations\b/i.test(primaryText)) journey_scope = 'ALL_CONSTELLATIONS';
    else if (/^\s*all\s+migrated\b/i.test(primaryText)) journey_scope = 'ALL_MIGRATED';
    else if (/^\s*all\b/i.test(primaryText)) journey_scope = 'ALL_CANONICAL';
    primary_journeys = ids(primaryText, 'J');
    consumer_journeys = ids(parts.join(';'), 'J').filter((id) => !primary_journeys.includes(id));
  }
  const seams = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^## .*seams/i.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^##\s/.test(lines[j])) break;
      const m = lines[j].match(/^[-*]\s+(.+)$/);
      if (!m) continue;
      const value = m[1].trim().replace(/^`|`$/g, '');
      seams.push({ value, kind: /[/\\]|\.(?:ts|tsx|js|mjs|prisma|yaml|yml|json)\b/.test(value) ? 'path_or_symbol' : 'conceptual', requires_revalidation: true });
    }
  }
  return { primary_journeys, consumer_journeys, primary_kernels, journey_scope, kernel_scope, seams };
}

export function buildPacketSemanticIndex({ dag, executionFiles, documents, intelligenceTopology = null, sourceRef }) {
  const packets = [];
  const contradictions = [];
  const knownJ = new Set((intelligenceTopology?.journeys || []).map((x) => x.id));
  const knownK = new Set((intelligenceTopology?.kernels || []).map((x) => x.id));
  for (const [packetId, phases] of dag.byPacket.entries()) {
    const candidates = executionFiles.filter((f) => path.basename(f).startsWith(packetId + '-') && f.endsWith('.md'));
    if (candidates.length !== 1) {
      contradictions.push({ id: 'ATLAS-PACKET-SOURCE-' + packetId, packet_id: packetId, type: candidates.length === 0 ? 'MISSING_PACKET_SOURCE' : 'AMBIGUOUS_PACKET_SOURCE', candidates, disposition: 'UNRESOLVED' });
      packets.push({ packet_id: packetId, title: phases[0]?.title || packetId, source_file: candidates[0] || null, primary_journeys: [], consumer_journeys: [], primary_kernels: [], seams: [], semantic_status: 'UNRESOLVED' });
      continue;
    }
    const source_file = candidates[0];
    const parsed = parsePacketSemantics(documents[source_file] || '');
    for (const id of [...parsed.primary_journeys, ...parsed.consumer_journeys]) if (knownJ.size && !knownJ.has(id)) contradictions.push({ id: 'ATLAS-PACKET-UNKNOWN-JOURNEY-' + packetId + '-' + id, packet_id: packetId, type: 'UNKNOWN_JOURNEY_REFERENCE', reference: id, source_file, disposition: 'UNRESOLVED' });
    for (const id of parsed.primary_kernels) if (knownK.size && !knownK.has(id)) contradictions.push({ id: 'ATLAS-PACKET-UNKNOWN-KERNEL-' + packetId + '-' + id, packet_id: packetId, type: 'UNKNOWN_KERNEL_REFERENCE', reference: id, source_file, disposition: 'UNRESOLVED' });
    if (!parsed.primary_journeys.length && !parsed.journey_scope) contradictions.push({ id: 'ATLAS-PACKET-MISSING-JOURNEY-' + packetId, packet_id: packetId, type: 'MISSING_PRIMARY_JOURNEY', source_file, disposition: 'UNRESOLVED' });
    if (!parsed.primary_kernels.length && !parsed.kernel_scope) contradictions.push({ id: 'ATLAS-PACKET-MISSING-KERNEL-' + packetId, packet_id: packetId, type: 'MISSING_PRIMARY_KERNEL', source_file, disposition: 'UNRESOLVED' });
    const journeyMapped = parsed.primary_journeys.length > 0 || Boolean(parsed.journey_scope);
    const kernelMapped = parsed.primary_kernels.length > 0 || Boolean(parsed.kernel_scope);
    packets.push({ packet_id: packetId, title: phases[0]?.title || packetId, source_file, source_ref: sourceRef, ...parsed, semantic_status: journeyMapped && kernelMapped ? 'MAPPED' : 'PARTIAL' });
  }
  return { schema: 'keyflowos-packet-semantic-index/v1', source_ref: sourceRef, programme_packets: dag.packetsTotal, packets: packets.sort((a,b) => a.packet_id.localeCompare(b.packet_id)), contradictions: contradictions.sort((a,b) => a.id.localeCompare(b.id)), status: contradictions.length ? 'PARTIAL_OR_CONTRADICTED' : 'MAPPED' };
}

export function buildFromGit(ref = process.env.KEYFLOW_INTELLIGENCE_REF || DEFAULT_REF) {
  const dag = loadDag(ROOT);
  const executionFiles = listFiles(ref);
  const documents = {};
  for (const packetId of dag.byPacket.keys()) for (const file of executionFiles.filter((x) => path.basename(x).startsWith(packetId + '-') && x.endsWith('.md'))) documents[file] = gitShow(ref, file);
  const intelligenceTopology = fs.existsSync(INTEL) ? JSON.parse(fs.readFileSync(INTEL, 'utf8')) : null;
  return buildPacketSemanticIndex({ dag, executionFiles, documents, intelligenceTopology, sourceRef: ref });
}
function main() {
  const index = buildFromGit();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(index, null, 2) + '\n');
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + index.packets.length + ' packets, ' + index.contradictions.length + ' contradiction(s))');
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
