/**
 * Behavioural proofs for the worker's command-authority boundary
 * (WORKER-DIRECTIVE-AUTHORITY-001, decided in CG-REVIEW-META-AUTO-WORKER-002).
 *
 * Anything select-directive.ps1 selects becomes a non-interactive Claude
 * session holding gh and git. These feed it fixture comments shaped exactly
 * like `gh issue view --json comments` output and assert the decision.
 *
 * Portable: runs under pwsh on Linux and Windows PowerShell alike.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PS, needsPowerShell } from './helpers/powershell.mjs';

const SELECTOR = 'scripts/agent-control/select-directive.ps1';
const OWNER = 'SaCH-PRO';

/** A control-room comment as gh returns it. */
function comment({ id, type = 'DIRECTIVE', sender = 'chatgpt', author = OWNER, extra = '' }) {
  const lines = ['```yaml', `message_id: ${id}`, `message_type: ${type}`, 'packet_id: KF-TEST-001'];
  if (sender !== null) lines.push(`sender: ${sender}`);
  if (extra) lines.push(extra);
  lines.push('```');
  return {
    author: { login: author },
    body: lines.join('\n'),
    createdAt: '2026-09-24T00:00:00Z',
    url: `https://example.invalid/${id}`,
  };
}

function select(comments, { processed = null, authors = OWNER } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-select-'));
  const commentsFile = path.join(dir, 'comments.json');
  fs.writeFileSync(commentsFile, JSON.stringify({ comments }), 'utf8');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(SELECTOR), '-CommentsFile', commentsFile, '-AuthorizedAuthors', authors];
  if (processed) {
    const cursorFile = path.join(dir, 'cursor.json');
    fs.writeFileSync(cursorFile, JSON.stringify({ processed_message_ids: processed }), 'utf8');
    args.push('-CursorFile', cursorFile);
  }
  const run = spawnSync(PS, args, { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  let out = null;
  try {
    out = JSON.parse(run.stdout.trim());
  } catch {
    /* leave null; the assertion shows the raw output */
  }
  return { status: run.status, out, raw: run.stdout + run.stderr };
}

const opts = { skip: needsPowerShell };

test('a ChatGPT directive from an allowlisted author is selected', opts, () => {
  const { status, out, raw } = select([comment({ id: 'CG-OK-001' })]);
  assert.equal(status, 0, raw);
  assert.equal(out.selected?.message_id, 'CG-OK-001');
  assert.equal(out.selected.author, OWNER);
  assert.equal(out.reason, 'selected');
});

test('a REVIEW is actionable too, and carries its routing fields', opts, () => {
  const { out } = select([
    comment({ id: 'CG-REV-001', type: 'REVIEW', extra: 'implementation_branch: impl/x\nsource_main: abc123' }),
  ]);
  assert.equal(out.selected?.message_type, 'REVIEW');
  assert.equal(out.selected.implementation_branch, 'impl/x');
  assert.equal(out.selected.source_main, 'abc123');
});

test('a directive with NO sender does not wake the worker', opts, () => {
  // The live wake harness proved this path once woke Claude.
  const { out } = select([comment({ id: 'HARNESS-001', sender: null })]);
  assert.equal(out.selected, null);
  assert.deepEqual(out.rejected.map((r) => r.message_id), ['HARNESS-001']);
  assert.match(out.rejected[0].reason, /^sender_not_chatgpt/);
});

test('a Claude-authored directive does not wake the worker', opts, () => {
  // Claude posts from the same GitHub account as ChatGPT, so only the sender
  // field separates them.
  const { out } = select([comment({ id: 'CC-SELF-001', sender: 'claude' })]);
  assert.equal(out.selected, null);
  assert.match(out.rejected[0].reason, /^sender_not_chatgpt:claude/);
});

test('any other sender does not wake the worker', opts, () => {
  for (const sender of ['github-autopilot', 'kimi', 'ChatGPT', 'chatgpt-bot', '']) {
    const { out } = select([comment({ id: `OTHER-${sender || 'EMPTY'}`, sender })]);
    assert.equal(out.selected, null, `sender "${sender}" must not be actionable`);
  }
});

test('a FORGED sender from a non-allowlisted GitHub account is rejected', opts, () => {
  // The repository is public: anyone can type `sender: chatgpt`.
  const { out } = select([comment({ id: 'FORGED-001', author: 'mallory' })]);
  assert.equal(out.selected, null);
  assert.equal(out.rejected[0].reason, 'author_not_authorized:mallory');
});

test('a comment with no author login is rejected', opts, () => {
  const c = comment({ id: 'GHOST-001' });
  c.author = null;
  const { out } = select([c]);
  assert.equal(out.selected, null);
  assert.match(out.rejected[0].reason, /^author_not_authorized/);
});

test('an empty allowlist authorizes nobody', opts, () => {
  const { out } = select([comment({ id: 'CG-OK-002' })], { authors: '' });
  assert.equal(out.selected, null);
});

test('author logins compare case-insensitively, as GitHub logins do', opts, () => {
  const { out } = select([comment({ id: 'CG-OK-003', author: 'sach-pro' })]);
  assert.equal(out.selected?.message_id, 'CG-OK-003');
});

test('AUTO_EVENT, ACK and plain text are never actionable', opts, () => {
  const { out } = select([
    comment({ id: 'AUTO-1', type: 'AUTO_EVENT', sender: 'github-autopilot' }),
    comment({ id: 'CC-ACK-1', type: 'ACK', sender: 'claude' }),
    comment({ id: 'CG-ACK-LIKE', type: 'directive' }), // wrong case is not DIRECTIVE
    { author: { login: OWNER }, body: 'just a plain comment', createdAt: '2026-09-24T00:00:00Z', url: 'u' },
  ]);
  assert.equal(out.selected, null);
  assert.equal(out.reason, 'no_actionable_message');
});

test('forged and senderless messages newer than a real one do not displace it', opts, () => {
  const { out } = select([
    comment({ id: 'CG-REAL-001' }),
    comment({ id: 'HARNESS-002', sender: null }),
    comment({ id: 'FORGED-002', author: 'mallory' }),
    comment({ id: 'CC-SELF-002', sender: 'claude' }),
  ]);
  assert.equal(out.selected?.message_id, 'CG-REAL-001');
  assert.deepEqual(out.rejected.map((r) => r.message_id).sort(), ['CC-SELF-002', 'FORGED-002', 'HARNESS-002']);
});

test('the newest actionable message wins; older ones are superseded', opts, () => {
  const { out } = select([comment({ id: 'CG-OLD-001' }), comment({ id: 'CG-NEW-001' })]);
  assert.equal(out.selected?.message_id, 'CG-NEW-001');
});

test('a processed newest message means nothing to do, never a replay of older ones', opts, () => {
  const { out } = select([comment({ id: 'CG-OLD-002' }), comment({ id: 'CG-NEW-002' })], { processed: ['CG-NEW-002'] });
  assert.equal(out.selected, null);
  assert.equal(out.reason, 'newest_already_processed:CG-NEW-002');
});

test('an unreadable cursor fails closed instead of replaying the channel', opts, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-select-'));
  const commentsFile = path.join(dir, 'comments.json');
  const cursorFile = path.join(dir, 'cursor.json');
  fs.writeFileSync(commentsFile, JSON.stringify({ comments: [comment({ id: 'CG-OK-004' })] }));
  fs.writeFileSync(cursorFile, 'not json');
  const run = spawnSync(
    PS,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(SELECTOR), '-CommentsFile', commentsFile, '-CursorFile', cursorFile, '-AuthorizedAuthors', OWNER],
    { encoding: 'utf8' },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(run.status, 2);
  assert.match(run.stdout, /cursor_unreadable/);
});
