/**
 * FU-CI-WINDOWS-INPUT-GATE (P39, D-279, R&D-1 C2): the Windows negative
 * controls run in shards, and the job that carries the required name
 * ("Windows worker proof") is an aggregate that fails unless every control in
 * the manifest was reported exactly once, live.
 *
 *   1. Shard assignment is deterministic and covers every control id of the
 *      real manifest exactly once, for any shard count; the manifest's ids are
 *      unique (a duplicate id could not be counted).
 *   2. A shard passes exactly its own controls, in manifest order, to the
 *      unchanged runner (proof-mutation.mjs runManifest) and reports each.
 *   3. The aggregate passes in exactly two cases: the input gate said skip
 *      (every Windows leg skipped, the diff named), or every leg succeeded and
 *      every manifest control was reported exactly once, live, at the gated
 *      head, by the shard it belongs to. A cancelled, skipped or failed leg, a
 *      missing or duplicated shard, a missing, duplicated or unknown control,
 *      a report for another commit or manifest, and a gate that failed or
 *      spoke about another head all fail it.
 *   4. End to end on a real repository: two shard processes and the
 *      aggregate, green; one report removed, red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../agent-control/lib/yaml.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MANIFEST = 'scripts/agent-control/negative-controls.yaml';
const shardMod = () => import('./worker-proof-shard.mjs');
const aggMod = () => import('./worker-proof-aggregate.mjs');

const realManifest = () => parseYaml(fs.readFileSync(path.join(ROOT, MANIFEST), 'utf8'));

const H = 'a'.repeat(40);
const B = 'b'.repeat(40);
const MB = 'c'.repeat(40);
const BLOB = 'd'.repeat(40);
const LEGS = ['suites', 'negative-controls'];

describe('worker proof shards: assignment', () => {
  it('the real manifest has one unique id per control', async () => {
    const { manifestIds } = await shardMod();
    const manifest = realManifest();
    const ids = manifestIds(manifest);
    assert.equal(ids.length, manifest.negative_controls.length);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.length > 300, `${ids.length} controls`);
  });

  it('every shard count covers every real control id exactly once, deterministically, balanced, in manifest order', async () => {
    const { manifestIds, assign } = await shardMod();
    const ids = manifestIds(realManifest());
    for (let n = 1; n <= 8; n += 1) {
      const shards = assign(ids, n);
      assert.equal(shards.length, n);
      assert.deepEqual(assign(ids, n), shards, 'deterministic');
      const seen = shards.flat();
      assert.equal(seen.length, ids.length, `n=${n}: no control dropped or doubled`);
      assert.deepEqual([...seen].sort(), [...ids].sort(), `n=${n}: exactly the manifest's ids`);
      const sizes = shards.map((s) => s.length);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `n=${n}: balanced ${sizes}`);
      for (const s of shards) assert.deepEqual(s, ids.filter((id) => s.includes(id)), 'manifest order within a shard');
    }
  });

  it('refuses a manifest it could not count, and a shard count that is not a positive integer', async () => {
    const { manifestIds, assign } = await shardMod();
    assert.throws(() => manifestIds({}), /negative_controls/);
    assert.throws(() => manifestIds({ negative_controls: [] }), /empty/);
    assert.throws(() => manifestIds({ negative_controls: [{ id: 'A' }, { claim: 'no id' }] }), /id/);
    assert.throws(() => manifestIds({ negative_controls: [{ id: 'A' }, { id: 'A' }] }), /duplicate/);
    assert.throws(() => manifestIds({ negative_controls: [{ id: 7 }] }), /id/);
    for (const n of [0, -1, 1.5, '2', NaN]) assert.throws(() => assign(['A'], n), /shard/, String(n));
  });
});

describe('worker proof shards: one shard', () => {
  const manifestText = [
    'version: 1',
    'negative_controls:',
    ...['NC-1', 'NC-2', 'NC-3', 'NC-4', 'NC-5'].flatMap((id) => [
      `  - id: ${id}`,
      '    mutation:',
      '      file: a.txt',
      '      find: good',
      '      replace: bad',
      '    proof_command: node check.mjs',
    ]),
    '',
  ].join('\n');

  it('hands the runner exactly its controls, in order, and reports each result', async () => {
    const { runShard } = await shardMod();
    const calls = [];
    const runner = (manifest) => {
      calls.push(manifest.negative_controls.map((c) => c.id));
      return { results: manifest.negative_controls.map((c) => ({ id: c.id, ok: true, detail: 'negative control is live' })) };
    };
    const { report, ok } = runShard({ manifestText, shard: 2, shards: 2, commit: H, manifestBlob: BLOB, runner });
    assert.deepEqual(calls, [['NC-2', 'NC-4']]);
    assert.equal(ok, true);
    assert.equal(report.schema, 'worker-proof-shard/1');
    assert.equal(report.shard, 2);
    assert.equal(report.shards, 2);
    assert.equal(report.commit, H);
    assert.equal(report.manifest_blob, BLOB);
    assert.deepEqual(report.assigned, ['NC-2', 'NC-4']);
    assert.deepEqual(report.results.map((r) => [r.id, r.ok]), [['NC-2', true], ['NC-4', true]]);
  });

  it('is not ok when a control is vacuous, dropped or extra', async () => {
    const { runShard } = await shardMod();
    const run = (results) => runShard({ manifestText, shard: 1, shards: 2, commit: H, manifestBlob: BLOB, runner: () => ({ results }) });
    const live = (id) => ({ id, ok: true, detail: 'live' });
    assert.equal(run([live('NC-1'), live('NC-3'), live('NC-5')]).ok, true);
    assert.equal(run([live('NC-1'), { id: 'NC-3', ok: false, detail: 'VACUOUS' }, live('NC-5')]).ok, false, 'vacuous');
    assert.equal(run([live('NC-1'), live('NC-5')]).ok, false, 'dropped');
    assert.equal(run([live('NC-1'), live('NC-3'), live('NC-5'), live('NC-2')]).ok, false, 'extra');
    assert.equal(run([live('NC-1'), live('NC-3'), live('NC-3')]).ok, false, 'doubled');
  });

  it('refuses a shard number outside 1..shards', async () => {
    const { runShard } = await shardMod();
    for (const shard of [0, 3, -1, 1.5]) {
      assert.throws(() => runShard({ manifestText, shard, shards: 2, commit: H, manifestBlob: BLOB, runner: () => ({ results: [] }) }), /shard/);
    }
  });
});

// --- the aggregate ------------------------------------------------------------------------------------------------

const IDS = ['NC-1', 'NC-2', 'NC-3', 'NC-4', 'NC-5'];
const SHARDS = 2;

async function reportsFor(ids = IDS, shards = SHARDS, commit = H) {
  const { assign } = await shardMod();
  return assign(ids, shards).map((assigned, i) => ({
    schema: 'worker-proof-shard/1',
    shard: i + 1,
    shards,
    commit,
    manifest_blob: BLOB,
    assigned,
    results: assigned.map((id) => ({ id, ok: true, detail: 'negative control is live' })),
  }));
}

const runDecision = { schema: 'worker-proof-gate/1', run: true, reason: 'scripts/agent-control/lib/yaml.mjs changed', event: 'pull_request', base: B, head: H, merge_base: MB, changed: ['scripts/agent-control/lib/yaml.mjs'] };
const skipDecision = { schema: 'worker-proof-gate/1', run: false, reason: `no proof input changed in ${MB}..${H}`, event: 'pull_request', base: B, head: H, merge_base: MB, changed: ['apps/web/a.tsx', 'docs/b.md'] };
const needsAll = (result, gate = 'success') => ({ gate: { result: gate, outputs: {} }, suites: { result }, 'negative-controls': { result } });

async function verdict(over = {}) {
  const { aggregate } = await aggMod();
  return aggregate({
    event: 'pull_request',
    decision: runDecision,
    expectedHead: H,
    needs: needsAll('success'),
    legs: LEGS,
    reports: await reportsFor(),
    manifestIds: IDS,
    manifestBlob: BLOB,
    shards: SHARDS,
    ...over,
  });
}

describe('worker proof aggregate: "Windows worker proof"', () => {
  it('passes when every leg succeeded and every control was reported exactly once, live', async () => {
    const v = await verdict();
    assert.equal(v.ok, true, v.problems.join('\n'));
    assert.match(v.lines.join('\n'), /5\/5 negative controls/);
  });

  it('passes a skip only when the gate said skip, every Windows leg was skipped, and it names the diff it checked', async () => {
    const v = await verdict({ decision: skipDecision, needs: needsAll('skipped'), reports: [] });
    assert.equal(v.ok, true, v.problems.join('\n'));
    const text = v.lines.join('\n');
    assert.match(text, new RegExp(`${MB}\\.\\.${H}`));
    assert.match(text, /apps\/web\/a\.tsx/);
    assert.match(text, /docs\/b\.md/);
  });

  it('fails a skip under the schedule, a skip whose legs ran, and a skip with no merge base', async () => {
    assert.equal((await verdict({ event: 'schedule', decision: { ...skipDecision, event: 'schedule' }, needs: needsAll('skipped'), reports: [] })).ok, false);
    assert.equal((await verdict({ decision: skipDecision, needs: needsAll('success'), reports: [] })).ok, false);
    assert.equal((await verdict({ decision: { ...skipDecision, merge_base: '' }, needs: needsAll('skipped'), reports: [] })).ok, false);
    assert.equal((await verdict({ decision: { ...skipDecision, event: 'merge_group' }, needs: needsAll('skipped'), reports: [] })).ok, false, 'the decision is for another event');
  });

  it('fails when the gate failed, or its decision is missing, malformed or about another head', async () => {
    for (const gate of ['failure', 'cancelled', 'skipped']) {
      assert.equal((await verdict({ needs: needsAll('success', gate) })).ok, false, gate);
    }
    assert.equal((await verdict({ needs: { suites: { result: 'success' }, 'negative-controls': { result: 'success' } } })).ok, false, 'no gate in needs');
    for (const decision of [null, undefined, '', 'not json', {}, { ...runDecision, run: 'true' }, { ...runDecision, head: 'e'.repeat(40) }, { ...runDecision, head: 'HEAD' }]) {
      assert.equal((await verdict({ decision })).ok, false, JSON.stringify(decision));
    }
    assert.equal((await verdict({ expectedHead: '' })).ok, false, 'no expected head');
  });

  it('fails when any Windows leg did not succeed: failed, cancelled, skipped or absent', async () => {
    for (const leg of LEGS) {
      for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
        const needs = needsAll('success');
        if (result === undefined) delete needs[leg];
        else needs[leg] = { result };
        assert.equal((await verdict({ needs })).ok, false, `${leg} ${result}`);
      }
    }
  });

  it('fails on a missing, duplicated or out-of-range shard report', async () => {
    const all = await reportsFor();
    assert.equal((await verdict({ reports: [all[0]] })).ok, false, 'missing');
    assert.equal((await verdict({ reports: [all[0], all[1], all[1]] })).ok, false, 'duplicated');
    assert.equal((await verdict({ reports: [all[0], { ...all[1], shard: 3 }] })).ok, false, 'out of range');
    assert.equal((await verdict({ reports: all.map((r) => ({ ...r, shards: 3 })) })).ok, false, 'another shard count');
    assert.equal((await verdict({ reports: [all[0], { ...all[1], schema: 'x' }] })).ok, false, 'another schema');
    assert.equal((await verdict({ reports: [] })).ok, false, 'none');
  });

  it('fails on a control missing, duplicated, unknown, vacuous, or reported by a shard it does not belong to', async () => {
    const all = await reportsFor();
    const drop = structuredClone(all);
    drop[0].results.pop();
    assert.equal((await verdict({ reports: drop })).ok, false, 'missing');
    const dup = structuredClone(all);
    dup[1].results.push({ id: 'NC-1', ok: true, detail: 'live' });
    const dupV = await verdict({ reports: dup });
    assert.equal(dupV.ok, false, 'duplicated');
    assert.ok(dupV.problems.some((p) => /NC-1/.test(p) && /2 times/.test(p)), dupV.problems.join('\n'));
    const unknown = structuredClone(all);
    unknown[0].results.push({ id: 'NC-404', ok: true, detail: 'live' });
    assert.equal((await verdict({ reports: unknown })).ok, false, 'unknown');
    const vacuous = structuredClone(all);
    vacuous[1].results[0].ok = false;
    assert.equal((await verdict({ reports: vacuous })).ok, false, 'vacuous');
    const swapped = structuredClone(all);
    [swapped[0].assigned, swapped[1].assigned] = [swapped[1].assigned, swapped[0].assigned];
    [swapped[0].results, swapped[1].results] = [swapped[1].results, swapped[0].results];
    assert.equal((await verdict({ reports: swapped })).ok, false, 'a shard ran the other shard\'s controls');
    const fewer = await verdict({ manifestIds: [...IDS, 'NC-6'] });
    assert.equal(fewer.ok, false, 'a control in the manifest that no shard ran');
    assert.ok(fewer.problems.some((p) => /NC-6/.test(p)), fewer.problems.join('\n'));
  });

  it('fails on a report for another commit or another manifest', async () => {
    const all = await reportsFor();
    assert.equal((await verdict({ reports: [all[0], { ...all[1], commit: 'e'.repeat(40) }] })).ok, false, 'commit');
    assert.equal((await verdict({ reports: [all[0], { ...all[1], manifest_blob: 'e'.repeat(40) }] })).ok, false, 'manifest');
  });
});

// --- end to end ---------------------------------------------------------------------------------------------------

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

describe('worker proof shards and aggregate: end to end on a real repository', () => {
  it('two shard processes and the aggregate are green; a missing report or a vacuous control is red', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kf-wps-')));
    try {
      git(dir, 'init', '-q');
      fs.writeFileSync(path.join(dir, 'a.txt'), 'good\n');
      fs.writeFileSync(path.join(dir, 'check.mjs'), "import fs from 'node:fs'; process.exit(fs.readFileSync('a.txt', 'utf8').includes('good') ? 0 : 1);\n");
      const control = (id, find = 'good') => [`  - id: ${id}`, '    mutation:', '      file: a.txt', `      find: ${find}`, '      replace: bad', '    proof_command: node check.mjs', '    timeout_ms: 60000'];
      fs.writeFileSync(path.join(dir, 'manifest.yaml'), ['version: 1', 'negative_controls:', ...control('NC-A'), ...control('NC-B'), ...control('NC-C'), ''].join('\n'));
      git(dir, 'add', '-A');
      git(dir, 'commit', '-qm', 'fixture');
      const head = git(dir, 'rev-parse', 'HEAD');
      const reports = path.join(dir, '..', `${path.basename(dir)}-reports`);
      for (const shard of [1, 2]) {
        const out = path.join(reports, `shard-${shard}`, 'report.json');
        const r = spawnSync(process.execPath, [path.join(HERE, 'worker-proof-shard.mjs'), '--manifest', 'manifest.yaml', '--shard', String(shard), '--of', '2', '--out', out], { cwd: dir, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, /LIVE/);
      }
      const decision = { schema: 'worker-proof-gate/1', run: true, reason: 'x', event: 'pull_request', base: head, head, merge_base: head, changed: [] };
      const env = (over = {}) => ({ ...process.env, DECISION: JSON.stringify(decision), EXPECTED_HEAD: head, EVENT_NAME: 'pull_request', NEEDS: JSON.stringify(needsAll('success')), ...over });
      const aggregate = (e) => spawnSync(process.execPath, [path.join(HERE, 'worker-proof-aggregate.mjs'), '--manifest', 'manifest.yaml', '--reports', reports, '--of', '2', '--legs', LEGS.join(',')], { cwd: dir, encoding: 'utf8', env: e });
      const green = aggregate(env());
      assert.equal(green.status, 0, green.stdout + green.stderr);
      assert.match(green.stdout, /3\/3 negative controls/);
      const skippedLeg = aggregate(env({ NEEDS: JSON.stringify({ ...needsAll('success'), suites: { result: 'skipped' } }) }));
      assert.equal(skippedLeg.status, 1, 'a skipped leg under a run decision');
      fs.rmSync(path.join(reports, 'shard-2'), { recursive: true });
      const red = aggregate(env());
      assert.equal(red.status, 1, red.stdout);
      assert.match(red.stdout + red.stderr, /NC-B/);

      // A vacuous control fails its shard process.
      fs.writeFileSync(path.join(dir, 'manifest.yaml'), ['version: 1', 'negative_controls:', ...control('NC-A'), ...control('NC-V', 'nowhere'), ''].join('\n'));
      git(dir, 'commit', '-qam', 'vacuous');
      const vac = spawnSync(process.execPath, [path.join(HERE, 'worker-proof-shard.mjs'), '--manifest', 'manifest.yaml', '--shard', '1', '--of', '1', '--out', path.join(reports, 'v.json')], { cwd: dir, encoding: 'utf8' });
      assert.equal(vac.status, 1, vac.stdout);
      assert.match(vac.stdout, /VACUOUS\s+NC-V/);
      fs.rmSync(reports, { recursive: true, force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
