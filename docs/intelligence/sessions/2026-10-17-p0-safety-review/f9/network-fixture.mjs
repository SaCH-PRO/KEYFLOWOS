import fs from 'node:fs';
import { getProbeConfig } from './probe-config.mjs';
// Loaded before the source CLI; source CLI arguments are not probe arguments.
const config = getProbeConfig([]);
const { REQUIRED_WORKFLOWS } = await import(config.sourceUrl('scripts/agent-control/lib/events.mjs'));

// GLOBAL FETCH IS REPLACED: these responses are in-memory fixtures.
// No request is forwarded to the network, including unexpected requests.
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), SEMANTIC = 'c'.repeat(40);
const root = '/repos/local/f9-fixture';
const reviewUrl = 'https://github.com/local/f9-fixture/pull/1#pullrequestreview-1';
const trace = [];
let stdout = '';
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => { stdout += String(chunk); return write(chunk, ...rest); };
const common = `packet_id: SYNTHETIC-F9\nimplementation_branch: impl/f9-fixture\npr_number: 1\nsource_main: ${BASE}\nproduction_touched: false\nmerge_authority: false\n`;
const ret = common + `source_head: ${SEMANTIC}\nreview_status: ACCEPT_FOR_ADMISSION\nstate: PROVING\nscope_changed: false\ntests:\n  failed: 0\n  skipped: 0\nsemantic_review:\n  implementer: claude\n  reviews:\n    - provider: copilot\n      reviewer: copilot-pull-request-reviewer[bot]\n      reviewed_head: ${HEAD}\n      outcome: PASS\n      reason: null\n      unresolved_substantive_findings: []\n      dispositioned_findings: []\n      evidence_location: ${reviewUrl}\n`;
const response = (data) => ({ ok: true, status: 200, statusText: 'OK', json: async () => data });
globalThis.fetch = async (url, init={}) => {
  const u = new URL(url), method = init.method || 'GET';
  const request = { method, path: u.pathname+u.search };
  trace.push(request);
  if (u.hostname !== 'api.github.com' || !u.pathname.startsWith(root+'/')) throw new Error('Fixture rejected unexpected target; no network access');
  if (method === 'GET' && u.pathname === root+'/pulls/1') return response({ number: 1, state: 'open', draft: false, title: 'Synthetic F9 only', head: {sha:HEAD,ref:'impl/f9-fixture'}, base: {sha:BASE} });
  if (method === 'GET' && u.pathname === root+'/contents/.agent-control/active-packet.yaml') return response({ content: Buffer.from(common).toString('base64') });
  if (method === 'GET' && u.pathname === root+'/contents/.agent-control/claude-return.yaml') return response({ content: Buffer.from(ret).toString('base64') });
  if (method === 'GET' && u.pathname === root+`/compare/${SEMANTIC}...${HEAD}`) return response({ status:'ahead', files:[{filename:'.agent-control/claude-return.yaml'}] });
  if (method === 'GET' && u.pathname === root+'/actions/runs') return response({ workflow_runs: REQUIRED_WORKFLOWS.map((name,i)=>({id:100+i,name,head_sha:HEAD,status:'completed',conclusion:'success',created_at:'2026-10-17T00:00:00Z'})) });
  if (method === 'GET' && u.pathname === root+'/pulls/1/reviews') return response([{ user:{login:'copilot-pull-request-reviewer[bot]',type:'Bot'},body:'**Findings:** 0',commit_id:HEAD,html_url:reviewUrl }]);
  if (method === 'GET' && u.pathname === root+'/issues/1/events') return response([]);
  if (method === 'PUT' && u.pathname === root+'/pulls/1/merge') { request.body = JSON.parse(init.body); return response({merged:true,sha:'e'.repeat(40),message:'MOCK ONLY — no remote action'}); }
  throw new Error(`Fixture rejected unexpected ${method} ${u.pathname}; no network access`);
};
process.on('exit', () => {
  fs.writeFileSync(config.outputPath('cli-request-trace.json'), JSON.stringify(trace,null,2));
  fs.writeFileSync(config.outputPath('cli-source-result.json'), stdout);
});
