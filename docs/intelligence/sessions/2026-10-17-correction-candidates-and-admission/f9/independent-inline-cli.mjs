#!/usr/bin/env node
// Portable replay of the reviewed actual-CLI inline fixture. No source files are edited.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const PACKAGE=path.dirname(fileURLToPath(import.meta.url));
assert.equal(process.argv.length,4,'usage: node independent-inline-cli.mjs <work-dir> <new-result-file>');
const WORK=path.resolve(process.argv[2]), RESULT=path.resolve(process.argv[3]);
assert.ok(!fs.existsSync(RESULT),'result must not already exist');
const source=path.join(WORK,'candidate');
const allowed=new Set(['PATH','SystemRoot','SYSTEMROOT','TEMP','TMP']);
for(const name of Object.keys(process.env)) if(!allowed.has(name)) delete process.env[name];
const {REPO,HEAD,BASE,SEMANTIC,grantComment,holdComment}=
  await import(pathToFileURL(path.join(source,'scripts/agent-control/tests/helpers/merge-grant-fixture.mjs')).href);
const {REQUIRED_WORKFLOWS}=
  await import(pathToFileURL(path.join(source,'scripts/agent-control/lib/events.mjs')).href);
const common='packet_id: KF-X-001\nimplementation_branch: impl/x\npr_number: 87\nsource_main: '+BASE+'\nproduction_touched: false\nmerge_authority: false\n';
const reviewUrl='https://github.com/'+REPO+'/pull/87#pullrequestreview-1';
const ret=common+[
  'source_head: '+SEMANTIC,'review_status: ACCEPT_FOR_ADMISSION','state: PROVING','scope_changed: false',
  'tests:','  failed: 0','  skipped: 0','semantic_review:','  implementer: claude','  reviews:',
  '    - provider: copilot','      reviewer: copilot-pull-request-reviewer[bot]','      reviewed_head: '+HEAD,
  '      outcome: PASS','      reason: null','      unresolved_substantive_findings: []',
  '      dispositioned_findings: []','      evidence_location: '+reviewUrl,'',
].join('\n');
const comments=[holdComment('HOLD','KF-X-001'),holdComment('RESUME','KF-X-001'),grantComment()];
const scenario={
  repo:REPO,pr:{number:87,state:'open',draft:false,head_sha:HEAD,base_sha:BASE,head_ref:'impl/x'},
  active:common,ret,
  compare:{[SEMANTIC+'...'+HEAD]:{status:'ahead',files:[{filename:'.agent-control/claude-return.yaml'}]}},
  runs:REQUIRED_WORKFLOWS.map((name,i)=>({id:100+i,name,head_sha:HEAD,status:'completed',conclusion:'success',created_at:'2026-10-17T00:00:00Z'})),
  reviews:[{user:{login:'copilot-pull-request-reviewer[bot]',type:'Bot'},body:'**Findings:** 0',commit_id:HEAD,html_url:reviewUrl}],
  events:[],comments_by_snapshot:[comments,comments],
};
process.env.GITHUB_TOKEN='synthetic-token-not-a-credential';
process.env.GITHUB_REPOSITORY=REPO;
process.env.PR_NUMBER='87';
process.env.KF_SYNTHETIC_GITHUB=JSON.stringify(scenario);
// No FILE setting: this explicitly exercises the retained inline compatibility path.
await import(pathToFileURL(path.join(source,'scripts/agent-control/tests/helpers/synthetic-github.mjs')).href);
const syntheticFetch=globalThis.fetch;
let puts=0,snapshots=0;
globalThis.fetch=async(url,init={})=>{
  if(init.method==='PUT')puts++;
  if(new URL(url).pathname==='/repos/'+REPO+'/pulls/87')snapshots++;
  return syntheticFetch(url,init);
};
const originalWrite=process.stdout.write.bind(process.stdout);
let stdout='';
process.stdout.write=(chunk)=>{stdout+=Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk);return true;};
process.on('exit',code=>{
  assert.equal(code,0);assert.equal(puts,1);assert.equal(snapshots,2);
  const response=JSON.parse(stdout);
  assert.equal(response.eligible,true);assert.equal(response.merge.merged,true);
  assert.match(response.merge.message,/SYNTHETIC/);
  const result={
    observed_at:new Date().toISOString(),runtime:{node:process.version,platform:process.platform},
    scope:'Actual candidate CLI with a self-contained synthetic HOLD_CLEAR scenario via inline JSON; every response supplied in process.',
    exit_code:code,snapshots,synthetic_merge_puts:puts,eligible:response.eligible,reason:response.reason,
    merge_message:response.merge.message,real_network_requests:0,real_merges:0,candidate_edits:[],
    fixture:'Generated from the pinned synthetic helper with the same reviewed positive-control contract; no external fixture path.',
    raw_transcript:'not persisted; the CLI JSON was checked in memory and summarized',
  };
  fs.writeFileSync(RESULT,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  originalWrite(JSON.stringify(result,null,2)+'\n');
});
process.argv=[process.execPath,path.join(source,'scripts/agent-control/auto-merge-admitted.mjs'),'--merge'];
await import(pathToFileURL(path.join(source,'scripts/agent-control/auto-merge-admitted.mjs')).href);
