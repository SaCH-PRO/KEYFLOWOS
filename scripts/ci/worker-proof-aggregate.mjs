#!/usr/bin/env node
/**
 * The aggregate behind the required check "Windows worker proof" (FU-CI-WINDOWS-INPUT-GATE, D-279; R&D-1 C2).
 *
 * It passes in exactly two cases:
 *   - SKIP: the input gate succeeded and decided skip for this event's head (a pull_request or merge_group, never
 *     the schedule), with its merge base, and every Windows leg was skipped. It prints the diff the gate checked.
 *   - RUN: the gate succeeded and decided run for this head, every Windows leg succeeded, and the shard reports
 *     account for the whole manifest: one report per shard 1..N, each for the gated head and the same manifest blob,
 *     each holding exactly the controls assignment gives that shard, and every control id of the manifest reported
 *     exactly once (none missing, none twice, none unknown), live.
 * Anything else fails it: a failed, cancelled or skipped leg, a gate that failed or spoke about another head or
 * event, a missing or duplicated shard, a missing, duplicated, unknown or vacuous control.
 *
 * Usage (the workflow passes the gate's outputs and every leg's result in the environment):
 *   DECISION=<gate decision JSON> NEEDS=<toJSON(needs)> EXPECTED_HEAD=<sha> EVENT_NAME=<event> \
 *   node scripts/ci/worker-proof-aggregate.mjs --manifest <path> --reports <dir> --of <N> --legs <job,job>
 * Exit 0 when it passes, 1 when it does not.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../agent-control/lib/yaml.mjs';
import { REPORT_SCHEMA, assign, manifestIds as idsOf } from './worker-proof-shard.mjs';

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GATED_EVENTS = new Set(['pull_request', 'merge_group']);

function parseDecision(decision) {
  if (decision && typeof decision === 'object') return decision;
  if (typeof decision !== 'string' || decision.trim() === '') return null;
  try {
    const parsed = JSON.parse(decision);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** The verdict: { ok, problems, lines }. See the header for the two passing cases. */
export function aggregate({ event, decision, expectedHead, needs, legs, reports, manifestIds, manifestBlob, shards }) {
  const problems = [];
  const lines = [];
  const d = parseDecision(decision);
  const gate = needs?.gate;

  if (!gate || gate.result !== 'success') problems.push(`the input gate did not succeed (${gate?.result ?? 'absent'})`);
  if (!d) problems.push('the gate gave no readable decision');
  if (typeof expectedHead !== 'string' || !SHA.test(expectedHead)) problems.push(`no expected head (${JSON.stringify(expectedHead ?? null)})`);
  if (d) {
    if (typeof d.run !== 'boolean') problems.push(`the decision's run is ${JSON.stringify(d.run)}, not a boolean`);
    if (typeof d.head !== 'string' || !SHA.test(d.head) || d.head !== expectedHead) problems.push(`the decision is for ${JSON.stringify(d.head)}, not the head ${expectedHead}`);
    if (d.event !== event) problems.push(`the decision is for the event ${JSON.stringify(d.event)}, this run is ${JSON.stringify(event)}`);
  }
  if (problems.length) return { ok: false, problems, lines };

  if (d.run === false) {
    if (!GATED_EVENTS.has(event)) problems.push(`a skip for the event ${event}: only pull_request and merge_group are gated`);
    if (typeof d.merge_base !== 'string' || !SHA.test(d.merge_base)) problems.push('a skip with no merge base');
    if (!Array.isArray(d.changed)) problems.push('a skip that does not name the paths it checked');
    for (const leg of legs) {
      const result = needs?.[leg]?.result;
      if (result !== 'skipped') problems.push(`the gate said skip but the leg ${leg} is ${result ?? 'absent'}`);
    }
    if (problems.length) return { ok: false, problems, lines };
    const count = d.changed_count ?? d.changed.length;
    lines.push(`SKIP (D-279): no Windows worker proof input changed in ${d.merge_base}..${d.head} (${count} path(s) checked; base ${d.base}).`);
    lines.push(`  gate: ${d.reason}`);
    lines.push(`  gate at the merge base: ${d.base_gate ?? 'not recorded'}`);
    for (const p of d.changed) lines.push(`  checked: ${JSON.stringify(p)}`);
    if (d.changed_truncated) lines.push(`  ... ${count - d.changed.length} more path(s) are listed in the gate job's log`);
    return { ok: true, problems, lines };
  }

  for (const leg of legs) {
    const result = needs?.[leg]?.result;
    if (result !== 'success') problems.push(`the leg ${leg} is ${result ?? 'absent'}, not success`);
  }
  const expected = assign(manifestIds, shards);
  const byShard = new Map();
  for (const report of reports) {
    if (!report || report.schema !== REPORT_SCHEMA) {
      problems.push(`a report with schema ${JSON.stringify(report?.schema)}`);
      continue;
    }
    if (report.shards !== shards) problems.push(`shard ${report.shard} reports ${report.shards} shards, not ${shards}`);
    if (!Number.isInteger(report.shard) || report.shard < 1 || report.shard > shards) {
      problems.push(`a report for shard ${JSON.stringify(report.shard)}, outside 1..${shards}`);
      continue;
    }
    if (byShard.has(report.shard)) problems.push(`shard ${report.shard} reported twice`);
    byShard.set(report.shard, report);
    if (report.commit !== d.head) problems.push(`shard ${report.shard} ran at ${report.commit}, not ${d.head}`);
    if (report.manifest_blob !== manifestBlob) problems.push(`shard ${report.shard} read manifest ${report.manifest_blob}, not ${manifestBlob}`);
    const want = expected[report.shard - 1];
    if (JSON.stringify(report.assigned) !== JSON.stringify(want)) problems.push(`shard ${report.shard} was assigned other controls than the manifest gives it`);
    const ran = Array.isArray(report.results) ? report.results.map((r) => r?.id) : [];
    if (JSON.stringify(ran) !== JSON.stringify(want)) problems.push(`shard ${report.shard} reported other controls than it was assigned`);
  }
  for (let k = 1; k <= shards; k += 1) if (!byShard.has(k)) problems.push(`no report from shard ${k}`);

  const counts = new Map(manifestIds.map((id) => [id, 0]));
  const vacuous = [];
  for (const report of reports) {
    for (const r of Array.isArray(report?.results) ? report.results : []) {
      if (!counts.has(r?.id)) {
        problems.push(`unknown control ${JSON.stringify(r?.id)} reported by shard ${report.shard}`);
        continue;
      }
      counts.set(r.id, counts.get(r.id) + 1);
      if (r.ok !== true) vacuous.push(r.id);
    }
  }
  for (const [id, n] of counts) {
    if (n === 0) problems.push(`control ${id} was not reported`);
    else if (n > 1) problems.push(`control ${id} was reported ${n} times`);
  }
  for (const id of vacuous) problems.push(`control ${id} is not live`);
  if (problems.length) return { ok: false, problems, lines };
  lines.push(`RUN (D-279): ${manifestIds.length}/${manifestIds.length} negative controls live across ${shards} shards at ${d.head}; every Windows leg succeeded.`);
  lines.push(`  gate: ${d.reason}`);
  return { ok: true, problems, lines };
}

/** Every *.json under `dir` (none when it is absent), parsed; an unreadable one is a null report. */
export function readReports(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) {
        try {
          out.push(JSON.parse(fs.readFileSync(full, 'utf8')));
        } catch {
          out.push(null);
        }
      }
    }
  };
  walk(dir);
  return out;
}

function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${String(r.stderr).trim()}`);
  return r.stdout;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function main(argv) {
  const manifest = arg(argv, '--manifest');
  const reportsDir = arg(argv, '--reports');
  const shards = Number(arg(argv, '--of'));
  const legs = String(arg(argv, '--legs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!manifest || !reportsDir || !Number.isInteger(shards) || shards < 1 || legs.length === 0) {
    process.stderr.write('usage: worker-proof-aggregate.mjs --manifest <path> --reports <dir> --of <N> --legs <job,job>\n');
    return 1;
  }
  let needs = null;
  try {
    needs = JSON.parse(process.env.NEEDS || 'null');
  } catch {
    needs = null;
  }
  const decision = process.env.DECISION;
  const parsed = parseDecision(decision);
  let manifestIds = [];
  let manifestBlob = null;
  const extra = [];
  if (parsed?.run === true) {
    // Count the manifest the gated head carries, read as git stores it.
    const head = git('rev-parse', '--verify', 'HEAD^{commit}').trim();
    if (head !== parsed.head) extra.push(`the aggregate checked out ${head}, not the gated head ${parsed.head}`);
    const rel = manifest.replace(/\\/g, '/').replace(/^\.\//, '');
    manifestIds = idsOf(parseYaml(git('cat-file', 'blob', `${head}:${rel}`)));
    manifestBlob = git('rev-parse', `${head}:${rel}`).trim();
  }
  const v = aggregate({
    event: process.env.EVENT_NAME,
    decision,
    expectedHead: process.env.EXPECTED_HEAD,
    needs,
    legs,
    reports: readReports(reportsDir),
    manifestIds,
    manifestBlob,
    shards,
  });
  const problems = [...extra, ...v.problems];
  const ok = v.ok && extra.length === 0;
  const text = ok ? v.lines.join('\n') : ['Windows worker proof: FAILED', ...problems.map((p) => `  - ${p}`)].join('\n');
  process.stdout.write(`${text}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${text}\n\`\`\`\n`);
  return ok ? 0 : 1;
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`worker-proof-aggregate: ${error.stack || error.message}\n`);
    process.exit(1);
  }
}
