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

let nextComment = 7000;
const commentUrl = (n) => `https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-${n}`;

/**
 * A control-room comment as `gh issue view --json comments` returns it, with
 * the full #80 envelope. Comments are numbered in call order, so a later call
 * is a newer comment. `extra` lines override envelope fields by key.
 */
function comment({ id, type = 'DIRECTIVE', sender = 'chatgpt', author = OWNER, extra = '', edited = false }) {
  const fields = { message_id: id, message_type: type, packet_id: 'KF-TEST-001' };
  if (sender !== null) fields.sender = sender;
  Object.assign(fields, {
    source_main: 'null',
    implementation_branch: 'null',
    state: 'RELEASED',
    health: 'GREEN',
    scope_changed: 'false',
    production_touched: 'false',
  });
  for (const line of extra ? extra.split('\n') : []) {
    const i = line.indexOf(':');
    fields[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  nextComment += 1;
  return {
    author: { login: author },
    body: ['```yaml', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '```'].join('\n'),
    createdAt: '2026-09-24T00:00:00Z',
    includesCreatedEdit: edited,
    url: commentUrl(nextComment),
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
    // Classified as not-ChatGPT, not as malformed ChatGPT authority: only the
    // former can never block an older real directive.
    assert.match(out.rejected[0]?.reason ?? '', /^sender_not_chatgpt:/, `sender "${sender}"`);
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
    { author: { login: OWNER }, body: 'just a plain comment', createdAt: '2026-09-24T00:00:00Z', includesCreatedEdit: false, url: commentUrl(6999) },
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

// ------------------------------------------------ shared AUTHORITY profile (D3)
// The selector now reads #80 through lib/control-envelope.mjs, the parser
// reconcile.mjs and event normalization use. These pin the rules it gained.

test('an EDITED comment from an allowlisted author fails closed; nothing is selected', opts, () => {
  const referent = select([comment({ id: 'CG-OK-010' })]);
  assert.equal(referent.out.selected?.message_id, 'CG-OK-010');
  for (const edited of [comment({ id: 'CG-OK-011', edited: true }), comment({ id: 'CC-ACK-011', type: 'ACK', sender: 'claude-code', edited: true })]) {
    const { status, out, raw } = select([comment({ id: 'CG-OK-012' }), edited]);
    assert.equal(status, 2, raw);
    assert.equal(out.selected, null);
    assert.match(out.reason, /^authority_edited:/);
  }
});

test('a MALFORMED newest ChatGPT message selects nothing and never falls back to an older one', opts, () => {
  const cases = [
    ['a repeated key', comment({ id: 'CG-BAD-001', extra: 'state: RELEASED\nhealth: GREEN' }), (c) => { c.body = c.body.replace('\n```', '\nhealth: RED\n```'); }],
    ['an unmatched quote', comment({ id: 'CG-BAD-002', extra: "packet_id: 'KF-TEST-001" }), () => {}],
    ['a missing envelope key', comment({ id: 'CG-BAD-003' }), (c) => { c.body = c.body.replace(/\nscope_changed: false/, ''); }],
    ['an invalid-first repeat', comment({ id: 'CG-BAD-004' }), (c) => { c.body = c.body.replace('\nmessage_type: DIRECTIVE', '\nmessage_type: PROGRESS\nmessage_type: DIRECTIVE'); }],
  ];
  for (const [name, bad, mutate] of cases) {
    const older = comment({ id: `CG-OLDER-${name.length}` });
    const newest = { ...bad };
    mutate(newest);
    // Re-number so the malformed one is newest.
    newest.url = bad.url.replace(/\d+$/, (n) => String(Number(n) + 100000));
    const { status, out, raw } = select([older, newest]);
    assert.equal(status, 0, raw);
    assert.equal(out.selected, null, `${name}: the older directive must not be selected`);
    assert.match(out.reason, /^newest_authority_malformed:/, name);
  }
});

test('a newer HOLD selects nothing: the worker never wakes on an older directive past a hold', opts, () => {
  const { out } = select([comment({ id: 'CG-DIR-020' }), comment({ id: 'CG-HOLD-020', type: 'HOLD' })]);
  assert.equal(out.selected, null);
  assert.equal(out.reason, 'newest_authority_not_actionable:HOLD:CG-HOLD-020');
});

test('inline YAML comments are read as the codec reads them', opts, () => {
  const { out } = select([comment({ id: 'CG-OK-030', extra: 'sender: chatgpt   # ChatGPT\nmessage_type: DIRECTIVE # the directive' })]);
  assert.equal(out.selected?.message_id, 'CG-OK-030');
  assert.equal(out.selected.message_type, 'DIRECTIVE');
});

test('authority that cannot be ordered fails closed', opts, () => {
  const c = comment({ id: 'CG-OK-040' });
  c.url = 'https://example.invalid/no-comment-id';
  const { status, out } = select([c]);
  assert.equal(status, 2);
  assert.match(out.reason, /^authority_order_ambiguous:/);
});

test('without node the wrapper fails closed rather than selecting', opts, () => {
  const probe = spawnSync(PS, ['-NoProfile', '-Command', '(Get-Process -Id $PID).Path'], { encoding: 'utf8' });
  const psPath = probe.stdout.trim();
  assert.ok(psPath && fs.existsSync(psPath), `resolved PowerShell path: ${psPath}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-select-'));
  const commentsFile = path.join(dir, 'comments.json');
  fs.writeFileSync(commentsFile, JSON.stringify({ comments: [comment({ id: 'CG-OK-050' })] }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  env.PATH = dir; // nothing on PATH, so no node
  const run = spawnSync(psPath, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(SELECTOR), '-CommentsFile', commentsFile, '-AuthorizedAuthors', OWNER], { encoding: 'utf8', env });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stdout, /node_unavailable/);
  assert.doesNotMatch(run.stdout, /CG-OK-050/);
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
