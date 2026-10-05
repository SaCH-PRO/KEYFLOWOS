#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKETS = path.join(ROOT, 'architecture/atlas/generated/packet-semantic-index.json');
const OUT = path.join(ROOT, 'architecture/atlas/generated/packet-code-links.json');

export function exactRepoPath(value) {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text) || path.isAbsolute(text)) return null;
  if (text.split('/').includes('..')) return null;
  if (!/^(?:apps|packages|scripts|architecture|docs|infrastructure|\.agent-control)\//.test(text)) return null;
  return text.replace(/\\/g, '/');
}

export function verifyPacketCodeLinks(index, repoRoot) {
  const links = [];
  const contradictions = [];
  let conceptualSeams = 0;
  let nonExactPathSeams = 0;

  for (const packet of index.packets || []) {
    for (const seam of packet.seams || []) {
      if (seam.kind !== 'path_or_symbol') { conceptualSeams += 1; continue; }
      const rel = exactRepoPath(seam.value);
      if (!rel) { nonExactPathSeams += 1; continue; }
      const full = path.join(repoRoot, rel);
      if (!fs.existsSync(full)) {
        contradictions.push({
          id: 'ATLAS-CODE-SEAM-MISSING-' + packet.packet_id + '-' + rel.replace(/[^A-Za-z0-9]+/g, '-'),
          packet_id: packet.packet_id,
          type: 'MISSING_DECLARED_CODE_SEAM',
          path: rel,
          source_file: packet.source_file || null,
          disposition: 'UNRESOLVED',
        });
        continue;
      }
      const stat = fs.statSync(full);
      links.push({
        packet_id: packet.packet_id,
        path: rel,
        node_id: 'code:' + rel,
        kind: stat.isDirectory() ? 'directory' : 'file',
        relation: 'characterizes_seam',
        evidence_class: 'observed',
        authority: 'current_code',
        confidence: 'high',
        source_file: packet.source_file || null,
        source_ref: packet.source_ref || index.source_ref || null,
      });
    }
  }

  return {
    schema: 'keyflowos-packet-code-links/v1',
    source_packet_index: 'architecture/atlas/generated/packet-semantic-index.json',
    links: links.sort((a,b) => (a.packet_id + a.path).localeCompare(b.packet_id + b.path)),
    contradictions: contradictions.sort((a,b) => a.id.localeCompare(b.id)),
    stats: {
      verified_links: links.length,
      missing_declared_paths: contradictions.length,
      conceptual_seams: conceptualSeams,
      non_exact_path_seams: nonExactPathSeams,
    },
    status: contradictions.length ? 'PARTIAL_OR_CONTRADICTED' : 'VERIFIED_AT_DECLARED_PATH_SCOPE',
  };
}

export function buildFromRepository(repoRoot = ROOT) {
  if (!fs.existsSync(PACKETS)) throw new Error('atlas code links: packet-semantic-index.json is missing; run pnpm architecture:atlas:packets first');
  const index = JSON.parse(fs.readFileSync(PACKETS, 'utf8'));
  return verifyPacketCodeLinks(index, repoRoot);
}

function main() {
  const result = buildFromRepository(ROOT);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + result.links.length + ' verified code links, ' + result.contradictions.length + ' contradiction(s))');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
