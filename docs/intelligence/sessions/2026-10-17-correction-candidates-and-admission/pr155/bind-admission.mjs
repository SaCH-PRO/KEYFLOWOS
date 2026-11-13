#!/usr/bin/env node
/**
 * Local rendering only. Supply fresh raw GitHub REVIEW and PR JSON snapshots.
 * No network, commit, branch update, ready transition, authority post or merge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { verifySource, readCandidate, bindCandidate, TARGET } from './admission-tools.mjs';
try {
  const [reviewPath,prPath,outPath,...extra]=process.argv.slice(2);
  if (!reviewPath || !prPath || !outPath || extra.length) throw new Error(
    'usage: node bind-admission.mjs <actual-review.json> <fresh-pr.json> <new-output-directory>');
  verifySource();
  const out=path.resolve(outPath);
  if (fs.existsSync(out)) throw new Error('output directory must not exist: '+out);
  const result=bindCandidate(readCandidate(),JSON.parse(fs.readFileSync(reviewPath,'utf8')),
                            JSON.parse(fs.readFileSync(prPath,'utf8')));
  fs.mkdirSync(path.join(out,'.agent-control'),{recursive:true});
  for (const [name,text] of Object.entries(result.files)) fs.writeFileSync(path.join(out,name),text,{flag:'wx'});
  fs.writeFileSync(path.join(out,'binding-receipt.json'),JSON.stringify({
    target:TARGET,binding:result.binding,status:'LOCAL_BOUND_RECORD_NOT_PUBLISHED',
    source:'caller-supplied GitHub snapshots; freshness must be established separately',
    remote_actions:[],new_worker_return:false,ready_authorized:false,merge_authorized:false,
  },null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:'LOCAL_BOUND_RECORD_NOT_PUBLISHED',output:out,binding:result.binding}));
} catch (error) { console.error(error.message); process.exitCode=2; }
