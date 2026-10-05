#!/usr/bin/env node
/**
 * Negative-control runner for application proofs.
 *
 * A proof that cannot fail proves nothing, and "the suite went red" is not the
 * same as "the test that makes this claim went red". For each control this
 * runner restores one defect (an exact text substitution in one source file),
 * reruns the named proof, and requires that the SPECIFIC tests the control
 * names fail as individual assertions. It then restores the file.
 *
 * A control is LIVE only when all of these hold:
 *   1. every test it names passed on the clean tree;
 *   2. the mutation applied to exactly one place;
 *   3. every test it names FAILED with the defect restored.
 * A mutated run that fails some other way (a file that no longer compiles, a
 * timeout that reports no assertions) does not make a control live: the named
 * tests must be reported, by name, as failed.
 *
 * It is the application-side counterpart of scripts/agent-control/proof-mutation.mjs,
 * whose substitution rules it reuses. That runner builds a throwaway git
 * worktree per control and judges by exit status; an application proof needs
 * installed dependencies and a migrated database, so this one mutates in place
 * (always restoring, including on error or interrupt) and judges by test name.
 *
 * Usage:
 *   node scripts/proof-admission/negative-controls.mjs --manifest <json> [--only id,id] [--out report.json]
 *
 * The environment (DATABASE_URL and the rest) is the caller's; this script
 * reads none of it and prints none of it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyMutation } from '../agent-control/proof-mutation.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const JOURNAL_SUFFIX = '.negative-control-original';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Run one proof and return test name -> status, or an error. */
export function runProof(proof, repoRoot = REPO_ROOT, extraArgs = []) {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kf-nc-')), 'report.json');
  const cwd = path.resolve(repoRoot, proof.cwd);
  const entry = path.resolve(repoRoot, proof.runner);
  const started = Date.now();
  const run = spawnSync(process.execPath, [entry, ...proof.args, ...extraArgs, '--reporter=json', `--outputFile=${outFile}`], {
    cwd,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: proof.timeoutMs ?? 900_000,
  });
  const seconds = Math.round((Date.now() - started) / 1000);

  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch {
    /* no report: the run died before the reporter wrote one */
  } finally {
    fs.rmSync(path.dirname(outFile), { recursive: true, force: true });
  }
  if (!report || !Array.isArray(report.testResults)) {
    return { ok: false, seconds, exit: run.status, error: 'the proof produced no report', statuses: new Map() };
  }

  const statuses = new Map();
  const titles = new Map();
  for (const suite of report.testResults) {
    for (const assertion of suite.assertionResults ?? []) {
      statuses.set(normalize(assertion.fullName), assertion.status);
      titles.set(normalize(assertion.fullName), assertion.title);
    }
  }
  return { ok: true, seconds, exit: run.status, statuses, titles };
}

function validate(manifest) {
  const problems = [];
  if (manifest?.manifestVersion !== 1) problems.push('manifestVersion must be 1');
  if (!manifest?.proofs || typeof manifest.proofs !== 'object') problems.push('proofs is required');
  if (!Array.isArray(manifest?.controls) || manifest.controls.length === 0) problems.push('controls is required');
  const ids = new Set();
  for (const c of manifest?.controls ?? []) {
    if (!c.id || ids.has(c.id)) problems.push(`control id missing or repeated: ${c.id}`);
    ids.add(c.id);
    if (!c.claim) problems.push(`${c.id}: claim is required`);
    if (!c.mutation?.file || typeof c.mutation.find !== 'string' || typeof c.mutation.replace !== 'string') {
      problems.push(`${c.id}: mutation needs file, find and replace`);
    }
    const proofs = Object.keys(c.mustFail ?? {});
    if (proofs.length === 0) problems.push(`${c.id}: mustFail names no proof`);
    for (const p of proofs) {
      if (!manifest.proofs?.[p]) problems.push(`${c.id}: unknown proof ${p}`);
      if (!Array.isArray(c.mustFail[p]) || c.mustFail[p].length === 0) problems.push(`${c.id}: mustFail.${p} is empty`);
    }
  }
  return problems;
}

export function runControls(manifest, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const log = options.log ?? (() => {});
  const only = options.only ?? null;
  const controls = manifest.controls.filter((c) => !only || only.includes(c.id));

  // A journal left behind means an earlier run died with a defect still
  // applied. Proving anything on that tree would be proving it on a mutant.
  const stranded = [...new Set(manifest.controls.map((c) => c.mutation.file))].filter((f) =>
    fs.existsSync(path.join(repoRoot, f) + JOURNAL_SUFFIX),
  );
  if (stranded.length) {
    throw new Error(
      `an interrupted run left a mutation applied; restore each file from its ${JOURNAL_SUFFIX} journal first: ${stranded.join(', ')}`,
    );
  }

  // Baselines: each proof this run needs, once, on the clean tree.
  const baselines = {};
  for (const name of new Set(controls.flatMap((c) => Object.keys(c.mustFail)))) {
    log(`baseline ${name} ...`);
    const result = runProof(manifest.proofs[name], repoRoot);
    const nonPassing = [...result.statuses].filter(([, status]) => status !== 'passed');
    baselines[name] = result;
    baselines[name].clean = result.ok && result.exit === 0 && nonPassing.length === 0;
    log(
      `baseline ${name}: ${result.statuses.size} tests, ${nonPassing.length} not passing, exit ${result.exit}, ${result.seconds}s`,
    );
  }

  const results = [];
  for (const control of controls) {
    const file = path.join(repoRoot, control.mutation.file);
    const entry = { id: control.id, claim: control.claim, live: false, proofs: {} };
    results.push(entry);

    const notInBaseline = [];
    for (const [proof, names] of Object.entries(control.mustFail)) {
      for (const name of names) {
        if (baselines[proof].statuses.get(normalize(name)) !== 'passed') notInBaseline.push(`${proof}: ${name}`);
      }
      if (!baselines[proof].clean) notInBaseline.push(`${proof}: the proof is not clean on the unmutated tree`);
    }
    if (notInBaseline.length) {
      entry.detail = 'named tests do not pass on the clean tree';
      entry.missing = notInBaseline;
      log(`VACUOUS  ${control.id}  ${entry.detail}`);
      continue;
    }

    // The original is journalled beside the file before it is touched. If this
    // process is killed between the mutation and the restore, the journal is
    // what says so: the next run refuses to start until it has been put back.
    const original = fs.readFileSync(file);
    const journal = file + JOURNAL_SUFFIX;
    fs.writeFileSync(journal, original);
    const restore = () => {
      fs.writeFileSync(file, original);
      fs.rmSync(journal, { force: true });
    };
    process.once('SIGINT', restore);
    try {
      const applied = applyMutation(repoRoot, control.mutation);
      if (!applied.ok) {
        entry.detail = `mutation not applied: ${applied.reason}`;
        log(`VACUOUS  ${control.id}  ${entry.detail}`);
        continue;
      }

      let allFailed = true;
      for (const [proof, names] of Object.entries(control.mustFail)) {
        // Only the named tests are run against the defect. They passed in the
        // full baseline, and each proof resets its state before every test.
        const pattern = names
          .map((n) => baselines[proof].titles.get(normalize(n)))
          .map((t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|');
        const mutated = runProof(manifest.proofs[proof], repoRoot, ['-t', pattern]);
        const stillPassing = names.filter((n) => mutated.statuses.get(normalize(n)) !== 'failed');
        const failedNow = [...mutated.statuses].filter(([, s]) => s === 'failed').map(([n]) => n);
        entry.proofs[proof] = {
          named: names.length,
          named_failed: names.length - stillPassing.length,
          not_failed: stillPassing.map((n) => `${n} [${mutated.statuses.get(normalize(n)) ?? 'not reported'}]`),
          total_failed: failedNow.length,
          seconds: mutated.seconds,
        };
        if (stillPassing.length) allFailed = false;
      }
      entry.live = allFailed;
      entry.detail = allFailed
        ? 'negative control is live'
        : 'VACUOUS: a named test did not fail with the defect restored';
    } finally {
      restore();
      process.removeListener('SIGINT', restore);
    }
    const summary = Object.entries(entry.proofs)
      .map(([p, r]) => `${p} ${r.named_failed}/${r.named} named failed (${r.total_failed} in all)`)
      .join('; ');
    log(`${entry.live ? 'LIVE   ' : 'VACUOUS'}  ${control.id}  ${summary}`);
  }

  return {
    packageId: manifest.packageId ?? null,
    total: results.length,
    live: results.filter((r) => r.live).length,
    vacuous: results.filter((r) => !r.live).length,
    baselines: Object.fromEntries(
      Object.entries(baselines).map(([name, b]) => [
        name,
        {
          tests: b.statuses.size,
          passed: [...b.statuses.values()].filter((s) => s === 'passed').length,
          skipped: [...b.statuses.values()].filter((s) => s !== 'passed' && s !== 'failed').length,
          failed: [...b.statuses.values()].filter((s) => s === 'failed').length,
          clean: b.clean,
        },
      ]),
    ),
    results,
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const manifestPath = arg('--manifest');
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    process.stderr.write(`manifest not found: ${manifestPath}\n`);
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const problems = validate(manifest);
  if (problems.length) {
    process.stderr.write(`manifest rejected:\n  ${problems.join('\n  ')}\n`);
    process.exit(2);
  }
  const only = arg('--only') ? arg('--only').split(',').map((s) => s.trim()) : null;
  const summary = runControls(manifest, { only, log: (line) => process.stdout.write(line + '\n') });
  process.stdout.write(`\n${summary.live}/${summary.total} negative controls are live\n`);
  const out = arg('--out');
  if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 2) + '\n');
  process.exit(summary.vacuous === 0 && summary.total > 0 ? 0 : 1);
}
