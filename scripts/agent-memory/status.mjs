#!/usr/bin/env node
// Generates docs/reconstruction/handoff/V1-STATUS.json and V1-STATUS.md from the plan of record
// plus what is on main. Local git only. See docs/development/agent-memory/README.md.
//
//   node scripts/agent-memory/status.mjs            write both files (reads origin/main)
//   node scripts/agent-memory/status.mjs --check    exit 1 when the files on disk are stale
//   node scripts/agent-memory/status.mjs --stdout   print the Markdown, write nothing
//   --with-branches --stdout                        also mark packets with an unmerged origin/pkt/V1-* branch in-progress
//   --ref <ref>                                     read another ref instead of origin/main
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildStatus, renderStatusMd, statusFingerprint, PLAN_PATH, PRIOR_STATUS_PATH, STATUS_JSON_PATH, STATUS_MD_PATH } from './lib.mjs';
import { repoRoot, revParse, commitDate, show, tryShow, firstCommitAdding, commitsSince, unmergedPacketBranches } from './git.mjs';

export function generate(root, ref, { withBranches = false } = {}) {
  const mainSha = revParse(root, ref);
  const plan = JSON.parse(show(root, ref, PLAN_PATH));
  const priorText = tryShow(root, ref, PRIOR_STATUS_PATH);
  const prior = priorText ? JSON.parse(priorText) : null;
  // New evidence is every commit that reached the ref after the prior status file was ADDED (a later
  // edit of that file must not move the base). The adding commit itself is not evidence.
  const baseSha = prior ? firstCommitAdding(root, ref, PRIOR_STATUS_PATH) : null;
  const commits = commitsSince(root, baseSha, ref);
  const branches = withBranches ? unmergedPacketBranches(root, ref) : null;
  return buildStatus({ plan, prior, commits, branches, mainSha, mainDate: commitDate(root, ref), baseSha });
}

const FLAGS = new Set(['--check', '--stdout', '--with-branches', '--ref']);

function main() {
  const args = process.argv.slice(2);
  const fail = (msg) => {
    console.error(`${msg}\nusage: node scripts/agent-memory/status.mjs [--check | --stdout [--with-branches]] [--ref <ref>]`);
    process.exit(2);
  };
  let ref = 'origin/main';
  for (let i = 0; i < args.length; i += 1) {
    if (!FLAGS.has(args[i])) fail(`unknown argument: ${args[i]}`);
    if (args[i] === '--ref') {
      ref = args[(i += 1)];
      if (!ref || ref.startsWith('--')) fail('--ref needs a value');
    }
  }
  const stdout = args.includes('--stdout');
  const withBranches = args.includes('--with-branches');
  if (withBranches && !stdout) fail('--with-branches needs --stdout: the committed file must be a function of main alone.');
  if (ref !== 'origin/main' && !stdout) fail('--ref needs --stdout: the committed file is generated from origin/main only.');
  const root = repoRoot();
  const status = generate(root, ref, { withBranches });
  const json = JSON.stringify(status, null, 1) + '\n';
  const md = renderStatusMd(status);
  if (stdout) return void process.stdout.write(md);
  const jsonFile = join(root, STATUS_JSON_PATH);
  const mdFile = join(root, STATUS_MD_PATH);
  if (args.includes('--check')) {
    // The file records the main sha it was generated at, and the merge that carries the file moves main,
    // so compare content, not the sha.
    const now = status._generated.main_sha.slice(0, 8);
    if (!existsSync(jsonFile)) {
      console.log(`V1-STATUS is MISSING: run node scripts/agent-memory/status.mjs`);
      process.exit(1);
    }
    const onDisk = JSON.parse(readFileSync(jsonFile, 'utf8'));
    const at = String(onDisk._generated?.main_sha ?? '').slice(0, 8);
    const fresh = statusFingerprint(onDisk) === statusFingerprint(status);
    console.log(
      fresh
        ? `V1-STATUS content is current for ${ref} (generated at ${at}, ${ref} now ${now}).`
        : `V1-STATUS is STALE (generated at ${at}, ${ref} now ${now}, and packet status has changed): run node scripts/agent-memory/status.mjs`,
    );
    process.exit(fresh ? 0 : 1);
  }
  writeFileSync(jsonFile, json);
  writeFileSync(mdFile, md);
  const s = status.summary;
  console.log(`main ${status._generated.main_sha.slice(0, 8)}: ${s.packets} packets, ${s.points} points`);
  for (const [k, v] of Object.entries(s.by_status)) console.log(`  ${k}: ${v.packets} (${v.pct_by_points}% of points)`);
  console.log(`  ready to start: ${s.todo_with_dependencies_met}; uncertain: ${s.uncertain.length}`);
  console.log(`wrote ${STATUS_JSON_PATH} and ${STATUS_MD_PATH}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
