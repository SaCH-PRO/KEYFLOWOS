#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ROOT,TARGET,CONTROL_PATHS,readJson,readCandidate,verifySource,
  validateCandidate,admissionBinding,bindCandidate,
} from './admission-tools.mjs';
import { parseYaml } from './source/scripts/agent-control/lib/yaml.mjs';
import { evaluateAdmission } from './source/scripts/agent-control/lib/admission.mjs';
import { preReturnEvidenceProblems } from './source/scripts/agent-control/lib/return-evidence.mjs';
import { evaluateSemanticReview,copilotReviewEvidence,chatgptReviewEvidence } from './source/scripts/agent-control/lib/semantic-review.mjs';
import { REQUIRED_WORKFLOWS } from './source/scripts/agent-control/lib/events.mjs';

const cases=[];
const pass=(name,fn)=>{ const detail=fn();cases.push({name,result:'PASS',detail:detail??null});};
const clone=structuredClone;
const sourceCount=verifySource();
const texts=readCandidate();
const {active,ret}=validateCandidate(texts);
const input=readJson('evidence/validation-input.json');
const pr=input.pr;
const originalRet=parseYaml(fs.readFileSync(path.join(ROOT,'source',CONTROL_PATHS[1]),'utf8'));
const originalActive=parseYaml(fs.readFileSync(path.join(ROOT,'source',CONTROL_PATHS[0]),'utf8'));
const compare=input.compare;
assert.equal(compare.status,'ahead');assert.equal(compare.behind_by,0);
assert.equal(compare.base_commit.sha,TARGET.semantic);
assert.equal(compare.commits.at(-1).sha,TARGET.head);
assert.deepEqual(compare.files.map(f=>f.filename).sort(),[...CONTROL_PATHS].sort());
const runs=input.runs.workflow_runs;
const timeline=input.timeline;
assert.ok(timeline.length<100,'timeline pagination must be completed before reuse');
const live={
  copilot:[copilotReviewEvidence(input.copilot)],
  chatgpt:[chatgptReviewEvidence(input.review)],
};
const snapshot={
  pr:{number:pr.number,state:pr.state,draft:pr.draft,head_ref:pr.head.ref,head_sha:pr.head.sha,base_sha:pr.base.sha},
  active,ret,workflow_runs:runs,
  ancestry:{source_head_is_ancestor:true,non_control_files:[]},
  contradictions:[],
  pr_transitions:timeline.map(e=>({event:e.event,created_at:e.created_at})),
  semantic_review_live:live,
  reviewed_head_lineage:{},
};
pass('all exported repository sources match exact published Git blobs',()=>({files:sourceCount,head:TARGET.head}));
pass('two candidate files satisfy binding, safety and truthful pre-RETURN evidence checks',()=>({
  artifact_binding_problems:[],pre_return_problems:[],future_proof:ret.exact_head_proof,
  merge_authority:active.merge_authority,worker_return:ret.return_message_id,
}));
pass('application scope, original proof obligations and explicit follow-ons remain unchanged',()=>{
  for (const key of ['objective','live_defect','hard_invariant','required_semantics','allowed_scope','prohibited_scope','proof_obligations','negative_controls','rollback','stop_conditions','return_contract','current_authorization']) assert.deepEqual(active[key],originalActive[key],key);
  for (const key of ['implementation','characterization','integration','proof_matrix','negative_controls','behaviour_changes','new_consumers_or_writers','open_findings','residual_risks','rollback_floor','settled_contradictions','deviations_from_packet','unresolved_contradictions']) assert.deepEqual(ret[key],originalRet[key],key);
  return {scope_changed:false,semantic_files_changed:0,follow_on_findings_preserved:true};
});
pass('actual published draft remains denied',()=>{
  const v=evaluateAdmission({...snapshot,active:originalActive,ret:originalRet});assert.equal(v.reason,'pr_is_draft');return v;
});
pass('candidate status cannot overcome the real draft barrier',()=>{
  const v=evaluateAdmission(snapshot);assert.equal(v.reason,'pr_is_draft');return v;
});
const reviewArgs={record:ret.semantic_review,source_head:TARGET.semantic,pr_head:TARGET.head,lineage:{},live};
pass('actual provider-neutral evidence satisfies reviewed semantics',()=>{
  const v=evaluateSemanticReview(reviewArgs);assert.equal(v.satisfied,true);return v;
});
pass('diagnostic only: pre-F9 evaluator ignores false merge flags after simulated ready transition',()=>{
  const v=evaluateAdmission({...snapshot,pr:{...snapshot.pr,draft:false}});
  assert.equal(v.eligible,true);return {simulation:true,real_pr_changed:false,merge_called:false,verdict:v};
});
const futureHead='f'.repeat(40);
const future={...snapshot,pr:{...snapshot.pr,head_sha:futureHead,draft:false},
  reviewed_head_lineage:{[TARGET.head]:{descends_from_source_head:true,ancestor_of_pr_head:true,non_control_files:[]}}};
pass('synthetic future artifact cannot inherit prior-head successful workflows',()=>{
  const v=evaluateAdmission(future);assert.equal(v.reason,'workflow_runs_not_at_exact_head');return {synthetic_future_sha:true,verdict:v};
});
pass('synthetic future artifact without runs stays missing',()=>{
  const v=evaluateAdmission({...future,workflow_runs:[]});assert.equal(v.reason,'missing_workflows');return v;
});
pass('synthetic future artifact with queued required runs stays pending',()=>{
  const pending=REQUIRED_WORKFLOWS.map((name,i)=>({name,id:i,head_sha:futureHead,status:'queued',conclusion:null,created_at:'2026-10-17T22:00:00Z'}));
  const v=evaluateAdmission({...future,workflow_runs:pending});assert.equal(v.reason,'required_check_pending_at_head');return v;
});
pass('synthetic ready transition requires newer transition-triggered checks',()=>{
  const v=evaluateAdmission({...snapshot,pr:{...snapshot.pr,draft:false},
    pr_transitions:[{event:'ready_for_review',created_at:'2099-01-01T00:00:00Z'}]});
  assert.equal(v.reason,'required_checks_predate_pr_transition');return v;
});
pass('original validator rejects premature proof promotion on the new artifact',()=>{
  const broken=clone(ret);broken.exact_head_proof[0].status='PROVEN';
  const problems=preReturnEvidenceProblems(broken);assert.ok(problems.some(p=>/must be PENDING/.test(p)));return {problems};
});
pass('original semantic validator rejects unavailable primary without live evidence',()=>{
  const v=evaluateSemanticReview({...reviewArgs,live:{copilot:[],chatgpt:live.chatgpt}});
  assert.equal(v.satisfied,false);return v;
});
pass('original semantic validator rejects edited fallback evidence',()=>{
  const edited={...input.review,updated_at:'2099-01-01T00:00:00Z'};
  const v=evaluateSemanticReview({...reviewArgs,live:{copilot:live.copilot,chatgpt:[chatgptReviewEvidence(edited)]}});
  assert.equal(v.satisfied,false);return v;
});
const draft=fs.readFileSync(path.join(ROOT,'admission-review.DRAFT.md'),'utf8');
const syntheticId=9000000001;
const syntheticReview={
  id:syntheticId,created_at:'2026-10-17T21:59:59Z',updated_at:'2026-10-17T21:59:59Z',
  user:{login:'SaCH-PRO'},issue_url:'https://api.github.com/repos/SaCH-PRO/KEYFLOWOS/issues/80',
  html_url:'https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-'+syntheticId,
  body:draft.replace('__ADMISSION_MESSAGE_ID__','CG-REVIEW-KF155-LOCAL-ADMISSION-TEST-001'),
};
pass('binding positive control renders only in memory using explicitly synthetic review metadata',()=>{
  const bound=bindCandidate(texts,syntheticReview,pr);
  assert.deepEqual(Object.keys(bound.files),CONTROL_PATHS);
  return {synthetic:true,real_comment_exists:false,files_rendered_in_memory:Object.keys(bound.files),remote_actions:[]};
});
const reject=(label,reviewArg,prArg,pattern)=>pass(label,()=>{
  assert.throws(()=>admissionBinding(reviewArg,prArg),pattern);return {rejected:true};
});
reject('binder rejects current semantic-only review as admission',input.review,pr,/predates|distinct later|admission field/);
reject('binder rejects moved head',syntheticReview,{...pr,head:{...pr.head,sha:'e'.repeat(40)}},/changed/);
reject('binder rejects moved base',syntheticReview,{...pr,base:{...pr.base,sha:'e'.repeat(40)}},/changed/);
reject('binder rejects non-draft PR',syntheticReview,{...pr,draft:false},/draft/);
reject('binder rejects edited review',{...syntheticReview,updated_at:'2026-10-17T22:00:00Z'},pr,/edited/);
reject('binder rejects outside author',{...syntheticReview,user:{login:'unrelated-author'}},pr,/authorized/);
reject('binder rejects merge grant',{...syntheticReview,body:syntheticReview.body.replace('merge_authority: false','merge_authority: true')},pr,/merge_authority/);
reject('binder rejects new state-changing effect',{...syntheticReview,body:syntheticReview.body.replace('control_effect: NO_STATE_CHANGE','control_effect: PACKET_ADMISSION')},pr,/control_effect/);
reject('binder rejects second RETURN consumption',{...syntheticReview,body:syntheticReview.body.replace('return_reconsumption: false','return_reconsumption: true')},pr,/return_reconsumption/);
reject('binder rejects ambiguous duplicated target',{...syntheticReview,body:syntheticReview.body+'\npr_number: 181\n'},pr,/AUTHORITY-profile valid/);
const result={
  created_at:new Date().toISOString(),runtime:{node:process.version,platform:process.platform},
  scope:'Local record preparation and actual unchanged repository pure validators; not application execution or new hosted proof.',
  target:TARGET,status:'LOCAL_UNBOUND_CANDIDATE',remote_actions:[],source_files_verified:sourceCount,
  cases:cases.length,passed:cases.length,failed:0,
  limitations:[
    'The positive binding control uses clearly synthetic review metadata and does not establish a real later admission decision.',
    'The caller must refresh GitHub authority, PR/base, workflows, lineage and review evidence before publishing.',
    'The real PR remains draft; no new worker RETURN, ready transition, commit, merge, production or provider effect occurred.',
    'Pre-F9 admission diagnostics do not independently enforce false merge_authority flags.',
  ],
  results:cases,
};
fs.mkdirSync(path.join(ROOT,'results'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'results/validation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
