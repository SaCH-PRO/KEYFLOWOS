#!/usr/bin/env node
// Generates docs/reconstruction/handoff/V1-STATUS.json and V1-STATUS.md from the plan of record
// plus what is on main. Local git only. See docs/development/agent-memory/README.md.
//
//   node scripts/agent-memory/status.mjs            write both files (reads origin/main)
//   node scripts/agent-memory/status.mjs --check    exit 1 when the files on disk are stale
//   node scripts/agent-memory/status.mjs --stdout   print the Markdown, write nothing
//   --with-branches --stdout                        also mark packets with an unmerged origin/pkt/V1-* branch in-progress
//   --ref <ref>                                     read another ref instead of origin/main
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildStatus, renderStatusMd, PLAN_PATH, PRIOR_STATUS_PATH, STATUS_JSON_PATH, STATUS_MD_PATH } from './lib.mjs';
import { repoRoot, revParse, commitDate, show, tryShow, lastCommitTouching, commitsSince, unmergedPacketBranches } from './git.mjs';

export function generate(root, ref, { withBranches = false } = {}) {
  const mainSha = revParse(root, ref);
  const plan = JSON.parse(show(root, ref, PLAN_PATH));
  const priorText = tryShow(root, ref, PRIOR_STATUS_PATH);
  const prior = priorText ? JSON.parse(priorText) : null;
  // Only commits that reached main after the prior status file was last written are new evidence.
  const baseSha = prior ? lastCommitTouching(root, ref, PRIOR_STATUS_PATH) : null;
  const commits = commitsSince(root, baseSha, ref);
  if (baseSha) commits.push(...commitsSince(root, `${baseSha}^`, baseSha)); // the base commit itself (wave 2b)
  const branches = withBranches ? unmergedPacketBranches(root, ref) : null;
  return buildStatus({ plan, prior, commits, branches, mainSha, mainDate: commitDate(root, ref), baseSha });
}

function main() {
  const args = process.argv.slice(2);
  const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : 'origin/main';
  const root = repoRoot();
  const withBranches = args.includes('--with-branches');
  if (withBranches && !args.includes('--stdout')) {
    console.error('--with-branches needs --stdout: the committed file must be a function of main alone.');
    process.exit(2);
  }
  const status = generate(root, ref, { withBranches });
  const json = JSON.stringify(status, null, 1) + '\n';
  const md = renderStatusMd(status);
  if (args.includes('--stdout')) return void process.stdout.write(md);
  const jsonFile = join(root, STATUS_JSON_PATH);
  const mdFile = join(root, STATUS_MD_PATH);
  if (args.includes('--check')) {
    const fresh = existsSync(jsonFile) && existsSync(mdFile) && readFileSync(jsonFile, 'utf8') === json && readFileSync(mdFile, 'utf8') === md;
    console.log(fresh ? `V1-STATUS is current for ${ref} (${status._generated.main_sha.slice(0, 8)}).` : `V1-STATUS is STALE for ${ref} (${status._generated.main_sha.slice(0, 8)}): run node scripts/agent-memory/status.mjs`);
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

if (import.meta.url === `file://${process.argv[1]}`) main();
