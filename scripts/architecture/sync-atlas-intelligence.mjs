#!/usr/bin/env node

/**
 * Synchronize canonical journey/kernel topology from the durable intelligence branch.
 *
 * This script reads the intelligence branch through git show so current-code checkout
 * and accepted-architecture evidence remain distinct. It emits an evidence snapshot
 * under architecture/atlas/generated/.
 *
 * Usage:
 *   node scripts/architecture/sync-atlas-intelligence.mjs
 *   KEYFLOW_INTELLIGENCE_REF=origin/docs/keyflow-intelligence-foundation node ...
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseYaml } from '../agent-control/lib/yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_REF = 'origin/docs/keyflow-intelligence-foundation';
const OUT = path.join(ROOT, 'architecture/atlas/generated/intelligence-topology.json');

const ANALYSIS_MAP = 'docs/intelligence/03-ANALYSIS-MAP.md';
const KERNEL_PROGRAMME = 'docs/intelligence/12-KERNEL-PROGRAMME.md';
const CURRENT_STATE = 'docs/intelligence/handoff/CURRENT-STATE.yaml';

export function parseCanonicalCatalogue(text, prefix) {
  const pattern = new RegExp(
    String.raw`^\\d+\\. \\`(${prefix}-\\d{3}) — ([^\\`]+)\\`$`,
    'gm',
  );
  return [...String(text).matchAll(pattern)].map((match) => ({
    id: match[1],
    name: match[2].trim(),
  }));
}

export function parseKernelHeadings(text) {
  return [...String(text).matchAll(
    /^## K(\d+) — ([^\n]+)\n\n\*\*Working ID:\*\* `(KF-KERNEL-\d{3})`/gm,
  )].map((match) => ({
    ordinal: Number(match[1]),
    name: match[2].trim().replace(/ Kernel$/, ''),
    id: match[3],
  }));
}

export function parsePrimaryJourneyLinks(text) {
  const out = [];
  const sections = String(text).split(/^## K\d+ — /gm).slice(1);
  for (const section of sections) {
    const header = section.match(/^([^\n]+)\n\n\*\*Working ID:\*\* `(KF-KERNEL-\d{3})`/);
    if (!header) continue;
    const kernelId = header[2];
    const block = section.match(/(?:Primary journeys|Major journeys):\n\n([\s\S]*?)(?:\n\n(?:Current|Core|Target|Primary|Working|---|##|#)|$)/);
    if (!block) continue;
    for (const match of block[1].matchAll(/^- J(\d+)\b[^\n]*$/gm)) {
      out.push({
        journey_id: `KF-JOURNEY-${String(Number(match[1])).padStart(3, '0')}`,
        kernel_id: kernelId,
      });
    }
  }
  return out;
}

export function buildIntelligenceTopology({
  analysisMapText,
  kernelProgrammeText,
  currentStateText,
  sourceRef = 'docs/keyflow-intelligence-foundation',
}) {
  const journeys = parseCanonicalCatalogue(analysisMapText, 'KF-JOURNEY');
  const kernelsFromMap = parseCanonicalCatalogue(analysisMapText, 'KF-KERNEL');
  const kernelsFromProgramme = parseKernelHeadings(kernelProgrammeText);
  const primaryLinks = parsePrimaryJourneyLinks(kernelProgrammeText);
  const currentState = parseYaml(currentStateText);
  const coverage = currentState?.coverage || {};

  const contradictions = [];

  const mapJourneyCount = journeys.length;
  if (
    Number.isFinite(Number(coverage.journeys)) &&
    Number(coverage.journeys) !== mapJourneyCount
  ) {
    contradictions.push({
      id: 'ATLAS-INTEL-CONTRADICTION-JOURNEY-COUNT',
      subject: 'canonical_journey_count',
      analysis_map_value: mapJourneyCount,
      current_state_value: Number(coverage.journeys),
      evidence: [
        { path: ANALYSIS_MAP, ref: sourceRef },
        { path: CURRENT_STATE, ref: sourceRef },
      ],
      disposition: 'UNRESOLVED',
    });
  }

  const mapKernelCount = kernelsFromMap.length;
  if (
    Number.isFinite(Number(coverage.kernels)) &&
    Number(coverage.kernels) !== mapKernelCount
  ) {
    contradictions.push({
      id: 'ATLAS-INTEL-CONTRADICTION-KERNEL-COUNT',
      subject: 'canonical_kernel_count',
      analysis_map_value: mapKernelCount,
      current_state_value: Number(coverage.kernels),
      evidence: [
        { path: ANALYSIS_MAP, ref: sourceRef },
        { path: CURRENT_STATE, ref: sourceRef },
      ],
      disposition: 'UNRESOLVED',
    });
  }

  const kernelMap = new Map(kernelsFromMap.map((k) => [k.id, k.name]));
  const kernelProgrammeMap = new Map(kernelsFromProgramme.map((k) => [k.id, k.name]));
  for (const [id, mapName] of kernelMap) {
    const programmeName = kernelProgrammeMap.get(id);
    if (!programmeName) {
      contradictions.push({
        id: `ATLAS-INTEL-CONTRADICTION-KERNEL-MISSING-${id}`,
        subject: id,
        analysis_map_value: mapName,
        kernel_programme_value: null,
        disposition: 'UNRESOLVED',
        evidence: [
          { path: ANALYSIS_MAP, ref: sourceRef },
          { path: KERNEL_PROGRAMME, ref: sourceRef },
        ],
      });
    }
  }

  const knownJourneyIds = new Set(journeys.map((j) => j.id));
  const knownKernelIds = new Set(kernelsFromMap.map((k) => k.id));
  for (const link of primaryLinks) {
    if (!knownJourneyIds.has(link.journey_id) || !knownKernelIds.has(link.kernel_id)) {
      contradictions.push({
        id: `ATLAS-INTEL-CONTRADICTION-PRIMARY-LINK-${link.kernel_id}-${link.journey_id}`,
        subject: 'primary_journey_link',
        value: link,
        disposition: 'UNRESOLVED',
        evidence: [{ path: KERNEL_PROGRAMME, ref: sourceRef }],
      });
    }
  }

  return {
    schema: 'keyflowos-intelligence-topology/v1',
    source_ref: sourceRef,
    source_files: [ANALYSIS_MAP, KERNEL_PROGRAMME, CURRENT_STATE],
    status: contradictions.length ? 'CONTRADICTED' : 'CONSISTENT',
    claims: {
      analysis_map_journeys: mapJourneyCount,
      current_state_journeys:
        Number.isFinite(Number(coverage.journeys)) ? Number(coverage.journeys) : null,
      analysis_map_kernels: mapKernelCount,
      current_state_kernels:
        Number.isFinite(Number(coverage.kernels)) ? Number(coverage.kernels) : null,
      journey_dossiers:
        Number.isFinite(Number(coverage.journey_dossiers))
          ? Number(coverage.journey_dossiers)
          : null,
      kernel_dossiers:
        Number.isFinite(Number(coverage.kernel_dossiers))
          ? Number(coverage.kernel_dossiers)
          : null,
    },
    journeys,
    kernels: kernelsFromMap,
    primary_journey_kernel_links: primaryLinks,
    contradictions,
  };
}

function gitShow(ref, file) {
  const result = spawnSync('git', ['show', `${ref}:${file}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `atlas intelligence: unable to read ${file} from ${ref}: ${String(result.stderr || '').trim()}`,
    );
  }
  return result.stdout;
}

export function buildFromGit(ref = process.env.KEYFLOW_INTELLIGENCE_REF || DEFAULT_REF) {
  return buildIntelligenceTopology({
    analysisMapText: gitShow(ref, ANALYSIS_MAP),
    kernelProgrammeText: gitShow(ref, KERNEL_PROGRAMME),
    currentStateText: gitShow(ref, CURRENT_STATE),
    sourceRef: ref,
  });
}

function main() {
  const topology = buildFromGit();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(topology, null, 2)}\n`);
  console.log(
    `wrote ${path.relative(ROOT, OUT)} (${topology.journeys.length} journeys, ${topology.kernels.length} kernels, ${topology.contradictions.length} contradiction(s))`,
  );
  if (topology.contradictions.length) {
    console.warn('atlas intelligence: contradictions preserved; no denominator promotion performed');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
