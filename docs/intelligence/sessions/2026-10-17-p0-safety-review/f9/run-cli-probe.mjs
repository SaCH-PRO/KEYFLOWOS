import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getProbeConfig } from './probe-config.mjs';
const config = getProbeConfig();
const p = spawnSync(process.execPath, ['--import',fileURLToPath(new URL('./network-fixture.mjs', import.meta.url)),config.sourcePath('scripts/agent-control/auto-merge-admitted.mjs'),'--merge'], {
  cwd:config.outDir, encoding:'utf8', env:{F9_CHECKOUT:config.checkout,F9_OUT_DIR:config.outDir,GITHUB_TOKEN:'synthetic-no-permissions',GITHUB_REPOSITORY:'local/f9-fixture',PR_NUMBER:'1'}, timeout:10000,
});
assert.equal(p.error, undefined);
assert.equal(p.status, 0, p.stderr);
const result = JSON.parse(fs.readFileSync(config.outputPath('cli-source-result.json'),'utf8'));
const trace = JSON.parse(fs.readFileSync(config.outputPath('cli-request-trace.json'),'utf8'));
assert.equal(result.eligible, true);
assert.equal(trace.filter(r=>r.method==='PUT').length, 1);
assert.equal(trace.filter(r=>r.path==='/repos/local/f9-fixture/pulls/1').length, 2);
assert.equal(trace.some(r=>r.path.includes('/issues/80')), false);
const summary = { purpose:'LOCAL_MOCK_ONLY_NO_NETWORK_NO_REMOTE_MUTATION', source_main:'98ee0202499ba87fa4ee13d58a2a9075016225bd', artifact_status:'ACCEPT_FOR_ADMISSION', both_artifact_merge_authority:false, independent_copilot_review:'PASS', current_control_room_authority_read:false, full_snapshots:2, observed_mock_merge_requests:1, expected_secure_merge_requests:0, source_cli_exit_code:p.status, source_cli_result:result };
fs.writeFileSync(config.outputPath('cli-probe-result.json'), JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
