import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function run(eventName, payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-auto-'));
  const p = path.join(dir, 'event.json');
  fs.writeFileSync(p, JSON.stringify(payload));
  const r = spawnSync(process.execPath, ['scripts/agent-control/normalize-event.mjs'], {
    env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: p },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('RETURN on control issue is actionable', () => {
  const r = run('issue_comment', { issue: { number: 80 }, comment: { body: 'message_id: X\nmessage_type: RETURN\npacket_id: P\nstate: PROVING\nhealth: GREEN' } });
  assert.equal(r.actionable, true);
  assert.equal(r.kind, 'RETURN');
  assert.equal(r.packet_id, 'P');
});

test('ordinary control progress is not a wake event', () => {
  const r = run('issue_comment', { issue: { number: 80 }, comment: { body: 'message_type: PROGRESS' } });
  assert.equal(r.actionable, false);
});

test('merged impl pull request is actionable', () => {
  const r = run('pull_request_target', { action: 'closed', pull_request: { number: 9, merged: true, head: { ref: 'impl/x', sha: 'abc' }, html_url: 'x' } });
  assert.equal(r.actionable, true);
  assert.equal(r.kind, 'PR_MERGED');
});

test('completed workflow with a PR is actionable', () => {
  const r = run('workflow_run', { workflow_run: { name: 'CI/CD Pipeline', status: 'completed', conclusion: 'success', head_sha: 'abc', pull_requests: [{ number: 9 }] } });
  assert.equal(r.actionable, true);
  assert.equal(r.kind, 'WORKFLOW_COMPLETED');
});
