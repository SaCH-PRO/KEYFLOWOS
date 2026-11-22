#!/usr/bin/env node
// Compiles one packet's context bundle. Local git only. See docs/development/agent-memory/README.md.
//
//   node scripts/agent-memory/bundle.mjs <PACKET-ID>              Markdown to stdout
//   node scripts/agent-memory/bundle.mjs <PACKET-ID> --json       schema-shaped JSON to stdout
//   node scripts/agent-memory/bundle.mjs <PACKET-ID> --out <file> write to a file instead
//   --ref <ref>                                                   read another ref instead of origin/main
import { writeFileSync } from 'node:fs';
import { buildBundle, renderBundleMd, parseRulings, PLAN_PATH, BUILD_MAP_PATH } from './lib.mjs';
import { repoRoot, revParse, show, treeFiles } from './git.mjs';
import { generate } from './status.mjs';

function main() {
  const args = process.argv.slice(2);
  const flagValue = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
  const valued = new Set([flagValue('--ref'), flagValue('--out')]);
  const id = args.find((a) => !a.startsWith('--') && !valued.has(a))?.replace(/^(pkt\/)?V1-/, '');
  if (!id) {
    console.error('usage: node scripts/agent-memory/bundle.mjs <PACKET-ID> [--json] [--out <file>] [--ref <ref>]');
    process.exit(2);
  }
  const ref = flagValue('--ref') ?? 'origin/main';
  const root = repoRoot();
  const mainSha = revParse(root, ref);
  const plan = JSON.parse(show(root, ref, PLAN_PATH));
  const status = generate(root, ref);
  const files = treeFiles(root, ref);
  const bundle = buildBundle({
    plan,
    packetId: id,
    rulings: parseRulings(show(root, ref, BUILD_MAP_PATH)),
    statusById: Object.fromEntries(status.packets.map((p) => [p.id, p.status])),
    fileExists: (p) => files.has(p),
    mainSha,
    statusSource: 'scripts/agent-memory/status.mjs (computed at this ref)',
  });
  if (!bundle) {
    console.error(`No packet "${id}" in ${PLAN_PATH} at ${ref} (${mainSha.slice(0, 8)}).`);
    process.exit(1);
  }
  const text = args.includes('--json') ? JSON.stringify(bundle, null, 1) + '\n' : renderBundleMd(bundle);
  const out = flagValue('--out');
  if (out) {
    writeFileSync(out, text);
    console.log(`wrote ${out} (${text.length} characters, health ${bundle.health.status})`);
  } else process.stdout.write(text);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
