#!/usr/bin/env node
// Recovered from the independent review's executed commands; no network or candidate edits.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
assert.equal(process.argv.length,4,'usage: node independent-extra-checks.mjs <work-dir> <new-result-file>');
const WORK=path.resolve(process.argv[2]), RESULT=path.resolve(process.argv[3]);
assert.ok(!fs.existsSync(RESULT),'result must not already exist');
const {evaluateMergeGrant:candidate}=await import(pathToFileURL(path.join(WORK,'candidate/scripts/agent-control/lib/merge-grant.mjs')).href);
const {evaluateMergeGrant:baseline}=await import(pathToFileURL(path.join(WORK,'baseline/scripts/agent-control/lib/merge-grant.mjs')).href);
const {grantComment,holdComment,target}=await import(pathToFileURL(path.join(WORK,'candidate/scripts/agent-control/tests/helpers/merge-grant-fixture.mjs')).href);
const sha256=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const summary=JSON.parse(fs.readFileSync(path.join(ROOT,'proof-summary.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'source-manifest.json'),'utf8'));
const changed=[];
for(const f of manifest.files) {
  const before=fs.readFileSync(path.join(WORK,'baseline',f.path));
  const after=fs.readFileSync(path.join(WORK,'candidate',f.path));
  assert.equal(blob(before),f.sha,f.path);
  if(!before.equals(after)) changed.push(f.path);
}
assert.deepEqual(changed.sort(),summary.changed_files.map(f=>f.path).sort());
for(const f of summary.changed_files) assert.equal(sha256(fs.readFileSync(path.join(WORK,'candidate',f.path))),f.after_sha256,f.path);
// Historical transcript hashes are retained in proof-summary.json; raw TAP is not published.

const rows=[];
const hold=()=>holdComment('HOLD','KF-X-001');
const release=()=>holdComment('RESUME','KF-X-001');
const bad=()=>{const r=release();r.body=r.body.replace('control_effect: HOLD_CLEAR','control_effect: NO_STATE_CHANGE');return r;};
const check=(name,comments,want)=>{const v=candidate(comments,target());assert.equal(v.granted,want,name);rows.push({name,granted:v.granted,reason:v.reason,result:'PASS'});};
check('release before later hold cannot cancel it',[release(),hold(),grantComment()],false);
check('rehold after valid release remains active',[hold(),release(),hold(),grantComment()],false);
check('bad release followed by valid release restores explicit permission',[hold(),bad(),release(),grantComment()],true);
check('valid release for a different packet cannot cancel target hold',[hold(),holdComment('RESUME','KF-OTHER-001'),grantComment()],false);
check('invalid release after a grant supersedes it',[hold(),release(),grantComment(),bad()],false);
// The first review command created this malformed release before the hold.
// Case 9 separately exercises the same malformed release after the hold.
const duplicateBefore=release();duplicateBefore.body+='control_effect: HOLD_CLEAR\n';
check('duplicate-effect release before a later hold leaves the hold active',[hold(),duplicateBefore,grantComment()],false);
const edited=release();edited.updated_at='2026-10-17T20:00:00Z';
check('edited release makes collection unverifiable',[hold(),edited,grantComment()],false);
const reproducer=[hold(),bad(),grantComment()];
assert.equal(baseline(reproducer,target()).granted,true);
check('same invalid-release counterexample now refuses',reproducer,false);
const held=hold(),duplicateAfter=release();duplicateAfter.body+='control_effect: HOLD_CLEAR\n';
check('duplicate-effect release after the hold cannot clear it',[held,duplicateAfter,grantComment()],false);

const result={
  observed_at:new Date().toISOString(),
  scope:'Independent pure-predicate ordering/provenance replay and reconstructed source verification; historical raw TAP is not republished or reverified here.',
  runtime:{node:process.version,platform:process.platform},
  source_artifact:summary.artifact,
  verification:{baseline_files:manifest.files.length,changed_files:changed,historical_tap_hashes_retained:summary.runs.length,historical_tap_transcripts_reverified:false},
  cases:rows.length,passed:rows.length,failed:0,results:rows,
  original_counterexample:{baseline_granted:true,candidate_granted:false},
  remote_actions:[],candidate_edits:[],
};
fs.writeFileSync(RESULT,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
