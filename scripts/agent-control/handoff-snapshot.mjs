#!/usr/bin/env node
/**
 * Print the read-only handoff snapshot as JSON: the same projector and
 * collector the owner console uses. (KF-META-HANDOFF-MONITOR-001)
 *
 * Usage:
 *   node scripts/agent-control/handoff-snapshot.mjs --fixture=<file> [--task=<comment id>] [--limit=N] [--noise]
 *   node scripts/agent-control/handoff-snapshot.mjs --live [--task=...]
 *
 * --live reads GitHub with GET requests only, using the read credential in
 * KEYFLOW_HANDOFF_MONITOR_GITHUB_TOKEN (or GH_TOKEN). The credential is never
 * printed. Exit 0 with a snapshot; 2 when nothing could be collected.
 */

import { createGithubTransport, createHandoffMonitor } from './lib/handoff-collector.mjs';
import { createFixtureTransport, loadFixture } from './lib/handoff-fixture-transport.mjs';
import { viewOf } from './lib/handoff-projector.mjs';

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
}

async function main() {
  const fixture = arg('fixture');
  let transport;
  if (typeof fixture === 'string') transport = createFixtureTransport(loadFixture(fixture));
  else if (arg('live')) transport = createGithubTransport({ token: process.env.KEYFLOW_HANDOFF_MONITOR_GITHUB_TOKEN || process.env.GH_TOKEN || '' });
  else {
    process.stderr.write('usage: handoff-snapshot.mjs --fixture=<file> | --live [--task=<id>] [--limit=N] [--noise]\n');
    return 2;
  }
  const monitor = createHandoffMonitor({ transport });
  const { snapshot, freshness } = await monitor.read();
  if (!snapshot) {
    process.stdout.write(`${JSON.stringify({ freshness }, null, 2)}\n`);
    return 2;
  }
  const task = arg('task');
  const view = viewOf(snapshot, { task: typeof task === 'string' ? task : undefined, limit: arg('limit'), includeNoise: arg('noise') === true });
  process.stdout.write(`${JSON.stringify({ ...view, freshness }, null, 2)}\n`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (err) => {
  process.stderr.write(`handoff-snapshot: ${err?.code || 'ERROR'}: ${err?.message || err}\n`);
  process.exitCode = 2;
});
