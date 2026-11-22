#!/usr/bin/env node
// Compiles one packet's context bundle. Local git only. See docs/development/agent-memory/README.md.
//
//   node scripts/agent-memory/bundle.mjs <PACKET-ID>              Markdown to stdout
//   node scripts/agent-memory/bundle.mjs <PACKET-ID> --json       schema-shaped JSON to stdout
//   node scripts/agent-memory/bundle.mjs <PACKET-ID> --out <file> write to a file instead
//   --ref <ref>                                                   read another ref instead of origin/main
import { writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBundle, renderBundleMd, parseRulings, PLAN_PATH, BUILD_MAP_PATH } from './lib.mjs';
import { repoRoot, revParse, show, treeFiles } from './git.mjs';
import { generate } from './status.mjs';

function main() {
  const args = process.argv.slice(2);
  const fail = (msg) => {
    console.error(`${msg}\nusage: node scripts/agent-memory/bundle.mjs <PACKET-ID> [--json] [--out <file>] [--ref <ref>]`);
    process.exit(2);
  };
  let ref = 'origin/main';
  let out = null;
  let json = false;
  let id = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') json = true;
    else if (a === '--ref' || a === '--out') {
      const v = args[(i += 1)];
      if (!v || v.startsWith('--')) fail(`${a} needs a value`);
      if (a === '--ref') ref = v;
      else out = v;
    } else if (a.startsWith('--')) fail(`unknown argument: ${a}`);
    else if (id) fail(`one packet id only (got ${id} and ${a})`);
    else id = a.replace(/^(pkt\/)?V1-/, '');
  }
  if (!id) fail('missing packet id');
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
    ref,
    statusSource: 'scripts/agent-memory/status.mjs (computed at this ref)',
  });
  if (!bundle) {
    console.error(`No packet "${id}" in ${PLAN_PATH} at ${ref} (${mainSha.slice(0, 8)}).`);
    process.exit(1);
  }
  const text = json ? JSON.stringify(bundle, null, 1) + '\n' : renderBundleMd(bundle);
  if (out) {
    writeFileSync(out, text);
    console.log(`wrote ${out} (${text.length} characters, health ${bundle.health.status})`);
  } else process.stdout.write(text);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
