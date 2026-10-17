import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './source/scripts/agent-control/lib/yaml.mjs';
import { preReturnEvidenceProblems } from './source/scripts/agent-control/lib/return-evidence.mjs';
import { artifactBindingProblems } from './source/scripts/agent-control/lib/admission.mjs';
import { normalizeComment, parseEnvelope, validateEnvelope, PROFILES, rejectionOf } from './source/scripts/agent-control/lib/control-envelope.mjs';
import { readEffect } from './source/scripts/agent-control/lib/authority-effects.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const TARGET = Object.freeze({
  repository: 'SaCH-PRO/KEYFLOWOS', number: 155,
  head: 'b30acfa7dcd4fdf96c67747ff8c4a66e4026937e',
  semantic: 'fe79181638e373584c3ca3184a39343a132040cd',
  base: '98ee0202499ba87fa4ee13d58a2a9075016225bd',
  branch: 'impl/kf-exec-auth-fail-closed-001',
  packet: 'KF-EXEC-AUTH-FAIL-CLOSED-001',
});
export const CONTROL_PATHS = Object.freeze([
  '.agent-control/active-packet.yaml', '.agent-control/claude-return.yaml',
]);
const must = (ok, reason) => { if (!ok) throw new Error(reason); };
export const readJson = (relative) => JSON.parse(fs.readFileSync(path.resolve(ROOT,relative),'utf8'));
export function verifySource() {
  const manifest = readJson('source-manifest.json');
  for (const f of manifest.files) {
    const data = fs.readFileSync(path.join(ROOT,'source',f.path));
    must(createHash('sha256').update(data).digest('hex') === f.sha256, 'source SHA256 changed: '+f.path);
    const git = createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');
    must(git === f.git_blob_sha, 'source Git blob changed: '+f.path);
  }
  return manifest.files.length;
}
export function readCandidate(directory = path.join(ROOT,'candidate')) {
  return Object.fromEntries(CONTROL_PATHS.map(p=>[p,fs.readFileSync(path.join(directory,p),'utf8')]));
}
export function validateCandidate(texts, {bound=false}={}) {
  const active = parseYaml(texts[CONTROL_PATHS[0]]);
  const ret = parseYaml(texts[CONTROL_PATHS[1]]);
  const problems = artifactBindingProblems({pr:{number:TARGET.number,head_ref:TARGET.branch},active,ret});
  must(problems.length === 0, 'artifact binding problems: '+JSON.stringify(problems));
  for (const [name,doc] of [['active',active],['return',ret]]) {
    must(doc.packet_id === TARGET.packet && doc.source_main === TARGET.base, name+' identity changed');
    must(doc.state === 'PROVING' && doc.health === 'YELLOW',name+' state/health changed');
    must(doc.review_status === 'ACCEPT_FOR_ADMISSION',name+' admission status changed');
    must(doc.merge_authority === false && doc.production_touched === false &&
         doc.provider_traffic === false && doc.scope_changed === false &&
         doc.programme_credit === 'ZERO',name+' safety fields changed');
    must(!Object.hasOwn(doc,'pr_head') && !Object.hasOwn(doc,'artifact_head'),
         name+' must not claim its own future SHA');
    must(doc.admission_record_update.prepared_from_artifact_head === TARGET.head,name+' parent changed');
    must(doc.admission_record_update.control_effect === 'NO_STATE_CHANGE',name+' effect changed');
    must(doc.admission_record_update.merge === 'NOT_AUTHORIZED' &&
         doc.admission_record_update.draft_transition === 'NOT_AUTHORIZED',name+' ready/merge boundary changed');
  }
  must(ret.source_head === TARGET.semantic,'semantic head changed');
  must(ret.return_message_id === null,'would duplicate or invent worker RETURN');
  const published = parseYaml(fs.readFileSync(path.join(ROOT,'source',CONTROL_PATHS[1]),'utf8'));
  must(JSON.stringify(ret.previous_return_message_ids)===JSON.stringify(published.previous_return_message_ids),
       'historical RETURN list changed');
  must(ret.admission_record_update.previous_return_comment_id===6112455909 &&
       ret.admission_record_update.previous_return_consumed_by===6240050804,'RETURN consumption history changed');
  must(ret.admission_notes.future_artifact_head===null,'future artifact SHA cannot self-bind');
  const evidenceProblems=preReturnEvidenceProblems(ret);
  must(evidenceProblems.length===0,'pre-RETURN evidence problems: '+JSON.stringify(evidenceProblems));
  const historical=ret.ci.previous_head_b30acfa7;
  must(historical.artifact_head===TARGET.head && historical.source_head===TARGET.semantic &&
       historical.base_sha===TARGET.base,'historical proof identity changed');
  must(ret.semantic_review.reviews[0].reviewed_head===TARGET.head &&
       ret.semantic_review.reviews[1].reviewed_head===TARGET.semantic,'semantic review heads changed');
  if (bound) {
    for (const text of Object.values(texts)) must(!/__ADMISSION_[A-Z_]+__/.test(text),'unbound admission placeholder remains');
    must(Number.isSafeInteger(active.current_authority_comment_id) &&
         active.current_authority_comment_id===ret.current_authority_comment_id,'authority comment binding mismatch');
    must(active.current_authority_message_id===ret.current_authority_message_id,'authority message binding mismatch');
  }
  return {active,ret,pre_return_problems:evidenceProblems,binding_problems:problems};
}

/** Validates supplied snapshots only. It performs no fetch or publication. */
export function admissionBinding(review, pr) {
  must(pr?.number===TARGET.number && pr.state==='open' && pr.draft===true && pr.merged===false,
       'PR must still be open, draft and unmerged');
  must(pr.head?.sha===TARGET.head && pr.head?.ref===TARGET.branch &&
       pr.base?.sha===TARGET.base && pr.base?.ref==='main','PR head, branch or base changed');
  must(pr.head?.repo?.full_name===TARGET.repository && pr.base?.repo?.full_name===TARGET.repository,
       'PR repository binding mismatch');
  const c=normalizeComment(review), env=parseEnvelope(c.body);
  const problems=validateEnvelope(env,PROFILES.AUTHORITY);
  must(problems.length===0,'review is not AUTHORITY-profile valid: '+JSON.stringify(problems));
  must(rejectionOf(env,c.author)===null,'review author or sender is not authorized');
  must(c.edited===false,'review edit provenance is missing or edited');
  must(Number.isSafeInteger(c.id) && c.id>0 && Number.isFinite(Date.parse(c.created_at)),
       'review immutable coordinate missing');
  const html='https://github.com/'+TARGET.repository+'/issues/80#issuecomment-'+c.id;
  must(review.html_url===html && review.issue_url==='https://api.github.com/repos/'+TARGET.repository+'/issues/80',
       'review must be the actual issue #80 comment');
  must(Date.parse(c.created_at)>Date.parse('2026-10-17T20:45:50Z'),'review predates the inspected proof closeout');
  must(/^CG-REVIEW-KF155-[A-Z0-9-]+$/.test(env.fields.message_id||'') &&
       env.fields.message_id!=='CG-REVIEW-KF155-006','a distinct later admission REVIEW is required');
  const fields={
    message_type:'REVIEW', sender:'chatgpt', packet_id:TARGET.packet,
    source_main:TARGET.base, source_head:TARGET.semantic, pr_head:TARGET.head,
    implementation_branch:TARGET.branch, pr_number:String(TARGET.number),
    in_reply_to:'CG-REVIEW-KF155-006',
    state:'PROVING',health:'YELLOW',scope_changed:'false',production_touched:'false',
    provider_traffic:'false',merge_authority:'false',programme_credit:'ZERO',
    control_effect:'NO_STATE_CHANGE',review_status:'ACCEPT_FOR_ADMISSION',
    decision:'ACCEPT_FOR_ADMISSION',worker_action:'none',draft_transition:'NOT_AUTHORIZED',
    prior_return_comment_id:'6112455909',prior_return_consumed_by:'6240050804',
    return_reconsumption:'false',
  };
  for (const [key,value] of Object.entries(fields)) must(env.fields[key]===value,'admission field '+key+' must equal '+value);
  must(!Object.hasOwn(env.fields,'return_comment_id') &&
       !Object.hasOwn(env.fields,'return_message_id'),'admission must not consume a worker RETURN again');
  const effect=readEffect({message_type:'REVIEW',envelope:env,problems});
  must(effect.ok && effect.effect==='NO_STATE_CHANGE','admission effect is invalid');
  return {message_id:env.fields.message_id,comment_id:c.id,url:html,created_at:c.created_at,effect:effect.effect};
}
export function bindCandidate(texts, review, pr) {
  validateCandidate(texts);
  const binding=admissionBinding(review,pr);
  const bound=Object.fromEntries(Object.entries(texts).map(([name,text])=>[name,text
    .replaceAll('__ADMISSION_MESSAGE_ID__',binding.message_id)
    .replaceAll('__ADMISSION_COMMENT_ID__',String(binding.comment_id))]));
  validateCandidate(bound,{bound:true});
  return {files:bound,binding};
}
