import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { grantComment,claudeNote,followUp,REPO } from './source/scripts/agent-control/tests/helpers/merge-grant-fixture.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url)),OUT=path.join(ROOT,'results');
const CLI=path.join(ROOT,'source/scripts/agent-control/auto-merge-admitted.mjs');
const ORIGINAL=pathToFileURL(path.join(ROOT,'source/scripts/agent-control/tests/helpers/synthetic-github.mjs')).href;
const ADAPTER=pathToFileURL(path.join(ROOT,'file-scenario-preload.mjs')).href;
const base=JSON.parse(fs.readFileSync(path.join(OUT,'proper-hold-clear-positive.scenario.json'),'utf8'));
const grant=grantComment(),fillers=Array.from({length:150},()=>claudeNote('PROGRESS'));
const comments=[...fillers,grant];
const s={...base,comments_by_snapshot:[comments,comments]},serialized=JSON.stringify(s);
const scenarioPath=path.join(OUT,'pagination.scenario.json');
fs.writeFileSync(scenarioPath,serialized);
const env={PATH:process.env.PATH,GITHUB_TOKEN:'synthetic-token-not-a-credential',GITHUB_REPOSITORY:REPO,PR_NUMBER:'87'};
const original=spawnSync(process.execPath,['--import',ORIGINAL,CLI,'--merge'],{encoding:'utf8',timeout:15000,env:{...env,KF_SYNTHETIC_GITHUB:serialized,KF_SYNTHETIC_TRACE:path.join(OUT,'pagination-original.trace.json')}});
const originalResult={status:original.status,signal:original.signal,error:original.error?{name:original.error.name,code:original.error.code,errno:original.error.errno,syscall:original.error.syscall,message:original.error.message}:null,trace_exists:fs.existsSync(path.join(OUT,'pagination-original.trace.json')),scenario_bytes:Buffer.byteLength(serialized),environment_entry_bytes:Buffer.byteLength('KF_SYNTHETIC_GITHUB='+serialized)+1};
assert.equal(originalResult.error?.code,'E2BIG');
assert.equal(originalResult.status,null);assert.equal(originalResult.trace_exists,false);

function adapted(name,input){
 const inputPath=path.join(OUT,`${name}.scenario.json`),tracePath=path.join(OUT,`${name}.trace.json`);
 fs.writeFileSync(inputPath,JSON.stringify(input));
 const child=spawnSync(process.execPath,['--import',ADAPTER,CLI,'--merge'],{encoding:'utf8',timeout:15000,env:{...env,KF_REVIEW_SCENARIO_FILE:inputPath,KF_SYNTHETIC_TRACE:tracePath}});
 assert.equal(child.error,undefined);assert.ok(fs.existsSync(tracePath));
 const trace=JSON.parse(fs.readFileSync(tracePath,'utf8')),out=JSON.parse(child.stdout);
 fs.writeFileSync(path.join(OUT,`${name}.stdout`),child.stdout);fs.writeFileSync(path.join(OUT,`${name}.stderr`),child.stderr??'');
 return {name,code:child.status,out,merge_puts:trace.filter(x=>x.method==='PUT').length,comment_reads:trace.filter(x=>x.path.startsWith(`/repos/${REPO}/issues/80/comments`)).length,snapshots:trace.filter(x=>x.path===`/repos/${REPO}/pulls/87`).length};
}
const granted=adapted('pagination-file-adapter-grant',s);
assert.equal(granted.code,0);assert.equal(granted.merge_puts,1);assert.equal(granted.comment_reads,4);assert.equal(granted.snapshots,2);
const revokedComments=[grant,...fillers,followUp()];
const revoked=adapted('pagination-file-adapter-revocation',{...base,comments_by_snapshot:[revokedComments,revokedComments]});
assert.equal(revoked.code,3);assert.equal(revoked.merge_puts,0);assert.equal(revoked.out.detail.reason,'merge_grant_superseded');assert.equal(revoked.comment_reads,2);
const result={artifact:'ff49859e70cee65e31c09277b05aca4144ff77ea',node:process.version,platform:process.platform,original_transport:originalResult,adapter_transport:[granted,revoked],scope:'Review-only file adapter, original source and fetch preload unchanged. No real credential, network or merge call. Adapter success is characterization, not a committed correction or original-test PASS.'};
fs.writeFileSync(path.join(OUT,'pagination-review-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
