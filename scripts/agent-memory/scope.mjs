#!/usr/bin/env node
// Report files changed on origin/main...<ref> outside a packet's declared write set
// (RR-HOOK-PACKET-SCOPE, D-239 scope-ledger re-verify). Local git only; no network.
//
// Usage:
//   node scripts/agent-memory/scope.mjs <PACKET-ID> [--ref <branch>] [--base <ref>] [--json]
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLAN_PATH, writeSetMatch } from './lib.mjs';
import { repoRoot, show } from './git.mjs';

const SAFE_REF_RE = /^[A-Za-z0-9._/@^{}~-]+$/;

function assertSafeRef(ref, label) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || !SAFE_REF_RE.test(ref)) {
    throw new Error(`invalid ${label}: ${String(ref)}`);
  }
}

export function scopeReport(root, packetId, { ref = 'HEAD', base = 'origin/main' } = {}) {
  assertSafeRef(ref, '--ref');
  assertSafeRef(base, '--base');
  const plan = JSON.parse(show(root, ref, PLAN_PATH));
  const packet = (plan.packets ?? []).find((p) => p.id === packetId);
  if (!packet) {
    return { found: false, packetId, ref, base, checkable: false, changed: [], inside: [], outside: [], writeSet: [] };
  }
  const writeSet = Array.isArray(packet.files) ? packet.files : [];
  const rawDiff = execFileSync('git', ['diff', '--name-only', `${base}...${ref}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const changed = rawDiff.split('\n').map((s) => s.trim()).filter(Boolean);
  const probe = writeSetMatch(changed[0] ?? 'probe', writeSet);
  if (!probe.checkable) {
    return { found: true, packetId, ref, base, checkable: false, changed, inside: [], outside: [], writeSet };
  }
  const inside = [];
  const outside = [];
  for (const f of changed) {
    const m = writeSetMatch(f, writeSet);
    if (m.inside) inside.push(f);
    else outside.push(f);
  }
  return { found: true, packetId, ref, base, checkable: true, changed, inside, outside, writeSet };
}

function main() {
  const args = process.argv.slice(2);
  let packetId = null;
  let ref = 'HEAD';
  let base = 'origin/main';
  let asJson = false;

  const fail = (msg) => {
    console.error(`${msg}\nusage: node scripts/agent-memory/scope.mjs <PACKET-ID> [--ref <branch>] [--base <ref>] [--json]`);
    process.exit(2);
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--ref') {
      ref = args[(i += 1)];
      if (!ref || ref.startsWith('--')) fail('--ref needs a value');
    } else if (a === '--base') {
      base = args[(i += 1)];
      if (!base || base.startsWith('--')) fail('--base needs a value');
    } else if (a === '--json') {
      asJson = true;
    } else if (a.startsWith('-')) {
      fail(`unknown argument: ${a}`);
    } else if (!packetId) {
      packetId = a;
    } else {
      fail(`unexpected argument: ${a}`);
    }
  }
  if (!packetId) fail('packet id is required');

  const root = repoRoot();
  const report = scopeReport(root, packetId, { ref, base });
  if (!report.found) {
    console.error(`packet ${packetId} not found in ${PLAN_PATH} at ${ref}`);
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Scope report for ${report.packetId} (${report.base}...${report.ref}):`);
  if (!report.checkable) {
    console.log('  not checkable (write set is empty or contains prose-only entries)');
    return;
  }
  console.log(`  changed: ${report.changed.length} | in write set: ${report.inside.length} | outside write set: ${report.outside.length}`);
  if (report.outside.length === 0) {
    console.log('  outside: (none)');
  } else {
    console.log('  outside:');
    for (const f of report.outside) console.log(`  - ${f}`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
