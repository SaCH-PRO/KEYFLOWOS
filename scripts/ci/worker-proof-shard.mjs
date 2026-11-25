#!/usr/bin/env node
/**
 * One shard of the Windows negative controls (FU-CI-WINDOWS-INPUT-GATE, D-279; R&D-1 C2).
 *
 * The manifest is read from the commit (never the working tree, which a Windows checkout writes with CRLF), its
 * controls are split round-robin in manifest order (control i goes to shard (i mod N) + 1), and this shard's controls
 * are handed, unchanged, to the same runner the unsharded step used (proof-mutation.mjs runManifest: one reused
 * worktree reset to pristine before each control, FU-CI-NC-WORKTREE-REUSE). The report names the shard, the commit,
 * the manifest blob, the controls assigned and each result; the aggregate ("Windows worker proof") counts the reports.
 *
 * Usage:
 *   node scripts/ci/worker-proof-shard.mjs --manifest <path> --shard <k> --of <N> --out <report.json>
 * Exit 0 when every assigned control is reported exactly once and live; 1 otherwise; 2 on a usage error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../agent-control/lib/yaml.mjs';
import { runManifest } from '../agent-control/proof-mutation.mjs';

export const REPORT_SCHEMA = 'worker-proof-shard/1';

/** The control ids of a parsed manifest, in order. Throws unless every control has a unique string id. */
export function manifestIds(manifest) {
  const controls = manifest?.negative_controls;
  if (!Array.isArray(controls)) throw new Error('the manifest has no negative_controls list');
  if (controls.length === 0) throw new Error('the manifest is empty');
  const ids = [];
  const seen = new Set();
  for (const [i, control] of controls.entries()) {
    const id = control?.id;
    if (typeof id !== 'string' || id.trim() === '') throw new Error(`control ${i} has no id`);
    if (seen.has(id)) throw new Error(`duplicate control id ${id}`);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** `ids` split into `shards` lists, round-robin in order: deterministic, balanced, each id exactly once. */
export function assign(ids, shards) {
  if (!Number.isInteger(shards) || shards < 1) throw new Error(`shard count ${shards} is not a positive integer`);
  const out = Array.from({ length: shards }, () => []);
  ids.forEach((id, i) => out[i % shards].push(id));
  return out;
}

/**
 * Runs shard `shard` (1-based) of `shards` over the manifest text with `runner` (runManifest by default). Returns
 * { report, ok }: ok only when each assigned control is reported exactly once, in no other company, and live.
 */
export function runShard({ manifestText, shard, shards, commit, manifestBlob, runner = runManifest, repoRoot = process.cwd(), ref = 'HEAD' }) {
  if (!Number.isInteger(shard) || shard < 1 || shard > shards) throw new Error(`shard ${shard} is not in 1..${shards}`);
  const manifest = parseYaml(manifestText);
  const ids = manifestIds(manifest);
  const assigned = assign(ids, shards)[shard - 1];
  const wanted = new Set(assigned);
  const controls = manifest.negative_controls.filter((c) => wanted.has(c.id));
  const summary = runner({ ...manifest, negative_controls: controls }, { repoRoot, ref });
  const results = (summary?.results || []).map((r) => ({ id: r.id, ok: r.ok === true, detail: r.detail ?? null }));
  const report = { schema: REPORT_SCHEMA, shard, shards, commit, manifest_blob: manifestBlob, assigned, results };
  const reported = results.map((r) => r.id);
  const ok = reported.length === assigned.length && reported.every((id, i) => id === assigned[i]) && results.every((r) => r.ok);
  return { report, ok };
}

function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${String(r.stderr).trim()}`);
  return r.stdout;
}

/** The manifest at a commit, as git stores it, and its blob id: the same bytes on every platform. */
export function manifestAt(commit, file) {
  const rel = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return { text: git('cat-file', 'blob', `${commit}:${rel}`), blob: git('rev-parse', `${commit}:${rel}`).trim() };
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function main(argv) {
  const manifest = arg(argv, '--manifest');
  const shard = Number(arg(argv, '--shard'));
  const shards = Number(arg(argv, '--of'));
  const out = arg(argv, '--out');
  if (!manifest || !out || !Number.isInteger(shard) || !Number.isInteger(shards)) {
    process.stderr.write('usage: worker-proof-shard.mjs --manifest <path> --shard <k> --of <N> --out <report.json>\n');
    return 2;
  }
  const commit = git('rev-parse', '--verify', 'HEAD^{commit}').trim();
  const { text, blob } = manifestAt(commit, manifest);
  const { report, ok } = runShard({ manifestText: text, shard, shards, commit, manifestBlob: blob, repoRoot: process.cwd(), ref: commit });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  for (const r of report.results) process.stdout.write(`${r.ok ? 'LIVE   ' : 'VACUOUS'}  ${r.id}  ${r.detail}\n`);
  const live = report.results.filter((r) => r.ok).length;
  process.stdout.write(`\nshard ${shard}/${shards} at ${commit}: ${live}/${report.assigned.length} negative controls are live (${report.results.length} reported)\n`);
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
    process.stderr.write(`worker-proof-shard: ${error.stack || error.message}\n`);
    process.exit(2);
  }
}
