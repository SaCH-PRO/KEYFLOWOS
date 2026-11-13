import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REQUIRED_WORKFLOWS } from './source/scripts/agent-control/lib/events.mjs';
import { collectAuthority } from './source/scripts/agent-control/lib/control-envelope.mjs';
import { readEffect } from './source/scripts/agent-control/lib/authority-effects.mjs';
import { REPO, HEAD, BASE, SEMANTIC, grantComment, holdComment } from './source/scripts/agent-control/tests/helpers/merge-grant-fixture.mjs';

// Independent review characterization. Repository source is imported unchanged.
// The repository preload replaces fetch before the real CLI is evaluated, rejects
// every unexpected request and answers merge PUT locally. No parent credentials
// reach a child. These are imaginary o/r PR87 comments, not live #80 messages.
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const OUT=path.join(ROOT,'results');
fs.mkdirSync(OUT,{recursive:true});
const CLI=path.join(ROOT,'source/scripts/agent-control/auto-merge-admitted.mjs');
const PRELOAD=pathToFileURL(path.join(ROOT,'source/scripts/agent-control/tests/helpers/synthetic-github.mjs')).href;
const reviewUrl=`https://github.com/${REPO}/pull/87#pullrequestreview-1`;
const common=`packet_id: KF-X-001\nimplementation_branch: impl/x\npr_number: 87\nsource_main: ${BASE}\nproduction_touched: false\nmerge_authority: false\n`;
const ret=common+[
 `source_head: ${SEMANTIC}`,'review_status: ACCEPT_FOR_ADMISSION','state: PROVING','scope_changed: false',
 'tests:','  failed: 0','  skipped: 0','semantic_review:','  implementer: claude','  reviews:',
 '    - provider: copilot','      reviewer: copilot-pull-request-reviewer[bot]',`      reviewed_head: ${HEAD}`,
 '      outcome: PASS','      reason: null','      unresolved_substantive_findings: []',
 '      dispositioned_findings: []',`      evidence_location: ${reviewUrl}`,'',
].join('\n');
function scenario(comments){
 return {repo:REPO,pr:{number:87,state:'open',draft:false,head_sha:HEAD,base_sha:BASE,head_ref:'impl/x'},active:common,ret,
 compare:{[`${SEMANTIC}...${HEAD}`]:{status:'ahead',files:[{filename:'.agent-control/claude-return.yaml'}]}},
 runs:REQUIRED_WORKFLOWS.map((name,i)=>({id:100+i,name,head_sha:HEAD,status:'completed',conclusion:'success',created_at:'2026-10-17T00:00:00Z'})),
 reviews:[{user:{login:'copilot-pull-request-reviewer[bot]',type:'Bot'},body:'**Findings:** 0',commit_id:HEAD,html_url:reviewUrl}],
 events:[],comments_by_snapshot:[comments,comments]};
}
function run(name,comments){
 const input=scenario(comments), tracePath=path.join(OUT,`${name}.trace.json`), serialized=JSON.stringify(input);
 fs.writeFileSync(path.join(OUT,`${name}.scenario.json`),JSON.stringify(input,null,2)+'\n');
 const child=spawnSync(process.execPath,['--import',PRELOAD,CLI,'--merge'],{encoding:'utf8',timeout:15000,
 env:{PATH:process.env.PATH,GITHUB_TOKEN:'synthetic-token-not-a-credential',GITHUB_REPOSITORY:REPO,PR_NUMBER:'87',KF_SYNTHETIC_GITHUB:serialized,KF_SYNTHETIC_TRACE:tracePath}});
 fs.writeFileSync(path.join(OUT,`${name}.stdout`),child.stdout??'');
 fs.writeFileSync(path.join(OUT,`${name}.stderr`),child.stderr??'');
 assert.equal(child.error,undefined,`CLI launch must execute: ${child.error}`);
 assert.ok(fs.existsSync(tracePath),'synthetic fetch preload must produce its trace');
 const trace=JSON.parse(fs.readFileSync(tracePath,'utf8')),out=JSON.parse(child.stdout);
 const puts=trace.filter(q=>q.method==='PUT');
 const commentsRead=trace.filter(q=>q.method==='GET'&&q.path.startsWith(`/repos/${REPO}/issues/80/comments`));
 const snapshots=trace.filter(q=>q.method==='GET'&&q.path===`/repos/${REPO}/pulls/87`);
 for(const q of puts)assert.equal(q.body.sha,HEAD);
 assert.equal(out.merge?.message===undefined||out.merge.message==='SYNTHETIC: answered in-process; no merge was sent',true);
 return {name,code:child.status,out,merge_puts:puts.length,comment_reads:commentsRead.length,snapshots:snapshots.length,scenario_bytes:Buffer.byteLength(serialized)};
}

const holdA=holdComment('HOLD','KF-X-001'),grantA=grantComment();
const held=run('hold-alone-denial',[holdA,grantA]);
assert.equal(held.code,3);assert.equal(held.merge_puts,0);assert.equal(held.out.detail.reason,'merge_grant_target_held');

const holdB=holdComment('HOLD','KF-X-001'),resumeB=holdComment('RESUME','KF-X-001'),grantB=grantComment();
const proper=run('proper-hold-clear-positive',[holdB,resumeB,grantB]);
assert.equal(proper.code,0);assert.equal(proper.merge_puts,1);assert.equal(proper.snapshots,2);assert.equal(proper.comment_reads,2);
const properEntry=collectAuthority([holdB,resumeB,grantB]).candidates.find(e=>e.comment_id===resumeB.id);
assert.equal(readEffect(properEntry).effect,'HOLD_CLEAR');

const holdC=holdComment('HOLD','KF-X-001'),resumeC=holdComment('RESUME','KF-X-001');
resumeC.body=resumeC.body.replace('control_effect: HOLD_CLEAR','control_effect: NO_STATE_CHANGE');
const grantC=grantComment();
const authority=collectAuthority([holdC,resumeC,grantC]);
assert.equal(authority.verified,true);
const invalidEntry=authority.candidates.find(e=>e.comment_id===resumeC.id);
assert.deepEqual(invalidEntry.problems,[]);
const invalidEffect=readEffect(invalidEntry);
assert.equal(invalidEffect.ok,false);assert.equal(invalidEffect.code,'CONTROL_EFFECT_TYPE_MISMATCH');
const invalid=run('invalid-resume-no-state-change',[holdC,resumeC,grantC]);
let safetyRequirement;
try {assert.equal(invalid.merge_puts,0,'an invalid RESUME must not clear the active hold');safetyRequirement={passed:true};}
catch(error){safetyRequirement={passed:false,name:error.name,message:error.message,actual:error.actual,expected:error.expected};}
// This asserts reproduction only; the safety requirement above is expected to fail
// on the reviewed source and its failure is retained as the product finding.
assert.equal(safetyRequirement.passed,false);assert.equal(invalid.code,0);assert.equal(invalid.snapshots,2);assert.equal(invalid.comment_reads,2);
invalid.resume_authority_valid=invalidEntry.problems.length===0;
invalid.resume_effect=invalidEffect;
invalid.safety_requirement=safetyRequirement;
const result={artifact:'ff49859e70cee65e31c09277b05aca4144ff77ea',semantic:'739414da0c5faeed1bbaf4a20deab27b9cfa18f1',base:'98ee0202499ba87fa4ee13d58a2a9075016225bd',node:process.version,platform:process.platform,source_changed:false,real_network_calls:0,real_merge_calls:0,credentials:'synthetic only',interpretation:'Counterexample reproduced; exit 0 of this review runner confirms characterization, not safety approval.',cases:[held,proper,invalid]};
fs.writeFileSync(path.join(OUT,'cli-review-result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
