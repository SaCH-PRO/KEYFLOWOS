import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getProbeConfig } from '../../2026-10-17-p0-safety-review/f9/probe-config.mjs';

// Evidence-runner correction only. The frozen source, manifest and no-network
// fixture are unchanged. This reproduces the historical defect at SOURCE_MAIN;
// it does not test a later F9 implementation or call a real merge endpoint.
const config = getProbeConfig();
const fixtureUrl = new URL('../../2026-10-17-p0-safety-review/f9/network-fixture.mjs', import.meta.url).href;

// --import consumes a URL. Keep the file: scheme on Windows and encode special
// path characters. Supply the small runtime environment needed to find git;
// never inherit actual GitHub credentials into the synthetic child.
const runtimeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SYSTEMROOT|WINDIR|PATHEXT|TEMP|TMP)$/i.test(key)));
const child = spawnSync(process.execPath, [
  '--import', fixtureUrl,
  config.sourcePath('scripts/agent-control/auto-merge-admitted.mjs'), '--merge',
], {
  cwd: config.outDir,
  encoding: 'utf8',
  env: {
    ...runtimeEnv,
    F9_CHECKOUT: config.checkout,
    F9_OUT_DIR: config.outDir,
    GITHUB_TOKEN: 'synthetic-no-permissions',
    GITHUB_REPOSITORY: 'local/f9-fixture',
    PR_NUMBER: '1',
  },
  timeout: 10000,
});
assert.equal(child.error, undefined);
assert.equal(child.status, 0, child.stderr);
const result = JSON.parse(fs.readFileSync(config.outputPath('cli-source-result.json'), 'utf8'));
const trace = JSON.parse(fs.readFileSync(config.outputPath('cli-request-trace.json'), 'utf8'));
assert.equal(result.eligible, true);
assert.equal(trace.filter(request => request.method === 'PUT').length, 1);
assert.equal(trace.filter(request => request.path === '/repos/local/f9-fixture/pulls/1').length, 2);
assert.equal(trace.some(request => request.path.includes('/issues/80')), false);
const summary = {
  purpose: 'LOCAL_MOCK_ONLY_NO_NETWORK_NO_REMOTE_MUTATION',
  runner: 'portable-file-url-and-runtime-environment-correction',
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  source_main: config.sourceMain,
  artifact_status: 'ACCEPT_FOR_ADMISSION',
  both_artifact_merge_authority: false,
  independent_copilot_review: 'PASS',
  current_control_room_authority_read: false,
  full_snapshots: 2,
  observed_mock_merge_requests: 1,
  expected_secure_merge_requests: 0,
  source_cli_exit_code: child.status,
  source_cli_result: result,
};
fs.writeFileSync(config.outputPath('cli-probe-result.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
