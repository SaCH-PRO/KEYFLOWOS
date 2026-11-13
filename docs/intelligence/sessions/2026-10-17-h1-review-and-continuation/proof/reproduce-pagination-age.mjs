import path from 'node:path';
import { pathToFileURL } from 'node:url';
const REPO = path.resolve(process.env.KF_H1_REPO || process.cwd());
const moduleUrl = (name) => pathToFileURL(path.join(REPO, 'scripts/agent-control/lib', name)).href;
import assert from 'node:assert/strict';
const { createHandoffMonitor } = await import(moduleUrl('handoff-collector.mjs'));
const { createFixtureTransport } = await import(moduleUrl('handoff-fixture-transport.mjs'));

const HEAD = 'a'.repeat(40), MAIN = 'c'.repeat(40);
const at = (minute) => `2026-10-17T05:${String(minute).padStart(2, '0')}:00Z`;
function msg(id, minute, fields) {
  return { id, created_at: at(minute), updated_at: at(minute), user: { login: 'SaCH-PRO' },
    body: Object.entries(fields).map(([k,v]) => `${k}: ${v}`).join('\n') };
}
const req = msg(9000000000, 1, { message_id: 'CG-REQ-1', message_type: 'DIRECTIVE', sender: 'chatgpt',
  recipient: 'claude', packet_id: 'KF-X-1', source_main: MAIN, source_head: HEAD,
  implementation_branch: 'impl/kf-x-1', pr_number: 'null', state: 'PROVING', health: 'YELLOW',
  scope_changed: false, production_touched: false, control_effect: 'NO_STATE_CHANGE' });

// A. At a full-page boundary, a 304 carries a new Link next, which the collector discards.
let clock = Date.parse(at(11));
const comments = Array.from({ length: 100 }, (_, i) => msg(8000000000+i, 1,
  { message_id: `CC-NOTE-${i}`, message_type: 'PROGRESS', sender: 'claude' }));
const transport = createFixtureTransport({ comments });
const monitor = createHandoffMonitor({ transport, now: () => clock,
  config: { minRefreshMs: 1, fullResyncMs: 3600000, backoffBaseMs: 1 } });
assert.equal((await monitor.read()).snapshot.counts.comments, 100);
transport.dataset.comments.push(msg(8000000100, 12, { message_id: 'CC-RETURN-new', message_type: 'RETURN', sender: 'claude' }));
clock = Date.parse(at(12));
const incremental = await monitor.read();
assert.equal(incremental.snapshot.counts.comments, 101);
assert.equal(incremental.freshness.coverage.status, 'COMPLETE');
const requestsBeforeFull = transport.requests.length;
monitor.config.fullResyncMs = 0;
clock = Date.parse(at(13));
const broken = await monitor.read();
assert.equal(broken.snapshot.counts.comments, 100);
assert.equal(broken.freshness.coverage.status, 'PARTIAL');
clock = Date.parse(at(14));
const stillBroken = await monitor.read();
assert.equal(stillBroken.snapshot.counts.comments, 100);
assert.equal(stillBroken.freshness.coverage.status, 'PARTIAL');
assert.equal(transport.requests.slice(requestsBeforeFull).some((x) => /page=2/.test(x.target)), false);
console.log(JSON.stringify({ case: 'ETAG_NEW_PAGE_LINK_IGNORED', before_full: incremental.snapshot.counts.comments,
  after_full: broken.snapshot.counts.comments, after_retry: stillBroken.snapshot.counts.comments,
  coverage: stillBroken.freshness.coverage, fetched_page2: false }));

// B. A no-change refresh preserves an age from the first collection even hours later.
const progress = msg(9000000001, 10, { message_id: 'CC-PROG-1', message_type: 'PROGRESS',
  sender: 'claude', in_reply_to: 'CG-REQ-1' });
let clock2 = Date.parse(at(11));
const monitor2 = createHandoffMonitor({ transport: createFixtureTransport({ comments: [req, progress] }),
  now: () => clock2, config: { minRefreshMs: 1, fullResyncMs: 0 } });
const fresh = await monitor2.read();
const before = fresh.snapshot.tasks[0].stages.WORKING_LAST_OBSERVED.age_seconds;
clock2 += 3600000;
const hourLater = await monitor2.read();
const after = hourLater.snapshot.tasks[0].stages.WORKING_LAST_OBSERVED.age_seconds;
assert.equal(before, 60);
assert.equal(after, 60);
assert.equal(hourLater.freshness.status, 'FRESH');
console.log(JSON.stringify({ case: 'PROGRESS_AGE_FROZEN', actual_age_seconds: (clock2-Date.parse(progress.created_at))/1000,
  displayed_age_seconds: after, freshness: hourLater.freshness.status,
  last_success_at: hourLater.freshness.last_success_at, observed_at: hourLater.snapshot.observed_at }));

// C. Normal new implementation: no PR at release, RETURN names the created PR.
const ret = msg(9000000002, 5, { message_id: 'CC-RETURN-1', message_type: 'RETURN', sender: 'claude',
  in_reply_to: 'CG-REQ-1', source_head: HEAD, pr_number: 500 });
const transport3 = createFixtureTransport({ comments: [req, ret], pulls: { 500: { head: { sha: HEAD }, state: 'open' } } });
const result = await createHandoffMonitor({ transport: transport3, now: () => Date.parse(at(11)) }).read();
assert.equal(result.freshness.coverage.pulls_requested, 0);
assert.equal(result.snapshot.tasks[0].revision.current_status, 'UNKNOWN');
console.log(JSON.stringify({ case: 'PRODUCED_PR_NEVER_COLLECTED', task_pr: result.snapshot.tasks[0].request.pr_number,
  return_pr: result.snapshot.messages.find((x) => x.message_id === 'CC-RETURN-1').pr_number,
  pulls_requested: result.freshness.coverage.pulls_requested, current_revision: result.snapshot.tasks[0].revision.current_status }));

console.log('Additional collector cases reproduced against unchanged PR #179 modules.');
