import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SOURCE_MAIN = '98ee0202499ba87fa4ee13d58a2a9075016225bd';

// Only local source reads and output writes. No clone, fetch, checkout or install.
export function getProbeConfig(argv = process.argv.slice(2)) {
  let checkout = process.env.F9_CHECKOUT;
  let outDir = process.env.F9_OUT_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    assert.ok(flag === '--checkout' || flag === '--out', `Unexpected argument: ${flag}`);
    const value = argv[++i];
    assert.ok(value && !value.startsWith('--'), `Missing value for ${flag}`);
    if (flag === '--checkout') checkout = value;
    else outDir = value;
  }
  assert.ok(checkout && outDir, 'Pass --checkout PATH --out PATH, or F9_CHECKOUT and F9_OUT_DIR.');
  checkout = fs.realpathSync(path.resolve(checkout));
  outDir = path.resolve(outDir);
  assert.ok(outDir !== checkout && !outDir.startsWith(checkout + path.sep), 'Keep evidence output outside the read-only source checkout.');

  const sourceMain = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  assert.equal(sourceMain, SOURCE_MAIN, 'This evidence is pinned to one source commit; do not assume the defect persists at another revision.');

  const manifest = JSON.parse(fs.readFileSync(new URL('./source-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.source_main, SOURCE_MAIN);
  for (const source of manifest.sources) {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(checkout, source.path))).digest('hex');
    assert.equal(digest, source.sha256, `Source differs from the inspected pinned bytes: ${source.path}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  return {
    checkout,
    outDir,
    sourceMain,
    sourcePath: (relative) => path.join(checkout, relative),
    sourceUrl: (relative) => pathToFileURL(path.join(checkout, relative)).href,
    outputPath: (name) => path.join(outDir, name),
  };
}
