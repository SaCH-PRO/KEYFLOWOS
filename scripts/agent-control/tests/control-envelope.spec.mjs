/**
 * The one #80 envelope parser (KF-META-CONTROL-PARSER-001, option T in
 * CG-REVIEW-META-CONTROL-PARSER-DECISION-001).
 *
 * Each negative control pairs the rejected input with a referent: the same
 * message without the defect is accepted, so the rejection is caused by the
 * defect under test and not by some other shape of the fixture.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AUTHORITY_FAILURES,
  PROFILES,
  collectAuthority,
  envelopeField,
  parseEnvelope,
  validateEnvelope,
} from '../lib/control-envelope.mjs';
import { reconcile, FINDINGS } from '../lib/reconcile.mjs';
import { emptyState } from '../lib/state.mjs';

const SHA = 'c'.repeat(40);

/** A well-formed authority body in the vocabulary live #80 authority uses. */
function fields(overrides = {}) {
  return {
    message_id: 'CG-DIRECTIVE-T-001',
    message_type: 'DIRECTIVE',
    packet_id: 'KF-T-001',
    sender: 'chatgpt',
    source_main: SHA,
    implementation_branch: 'impl/t',
    state: 'RELEASED',
    health: 'GREEN',
    scope_changed: 'false',
    production_touched: 'false',
    ...overrides,
  };
}
const body = (f) => ['```yaml', ...Object.entries(f).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`), '```'].join('\n');
const authority = (b) => validateEnvelope(parseEnvelope(b), PROFILES.AUTHORITY);
const activation = (b) => validateEnvelope(parseEnvelope(b), PROFILES.ACTIVATION);

let nextId = 9000;
/** REST-shaped comment; updated_at === created_at means never edited. */
function rest(b, { author = 'SaCH-PRO', at, id, updated } = {}) {
  nextId += 1;
  const created = at ?? new Date(Date.UTC(2026, 8, 27, 0, 0, nextId - 9000)).toISOString();
  return { id: id ?? nextId, created_at: created, updated_at: updated ?? created, user: { login: author }, body: b };
}
const ids = (auth) => auth.messages.map((m) => m.message_id);

// ------------------------------------------------------------- FIELD SYNTAX

test('referent: a well-formed live-vocabulary message is authority', () => {
  assert.deepEqual(authority(body(fields())), []);
  const auth = collectAuthority([rest(body(fields()))]);
  assert.equal(auth.verified, true);
  assert.deepEqual(ids(auth), ['CG-DIRECTIVE-T-001']);
});

test('NC repeated key: any repeated top-level key is ambiguous, with no first-wins value', () => {
  for (const [key, value] of [['message_type', 'HOLD'], ['sender', 'chatgpt'], ['merge_authority', 'true'], ['state', 'RELEASED']]) {
    // A second fenced block, as CG-REVIEW-META-STATE-RECONCILE-001 repeated merge_authority.
    const b = `${body(fields({ merge_authority: 'false' }))}\n\`\`\`yaml\n${key}: ${value}\n\`\`\``;
    assert.ok(authority(b).includes(`${key} (repeated; ambiguous)`), `${key} repeat must be rejected`);
    assert.equal(envelopeField(parseEnvelope(b), key), null, 'a repeated key has no usable value');
  }
});

test('NC invalid-first repeat: a repeat whose first value is not authority still counts as authority, malformed', () => {
  // The first occurrence would fail a first-wins filter and the message would vanish.
  for (const [key, first] of [['message_type', 'PROGRESS'], ['sender', 'claude-code'], ['message_type', 'AUTO_EVENT']]) {
    const b = body(fields()).replace(`\n${key}: `, `\n${key}: ${first}\n${key}: `);
    const auth = collectAuthority([rest(b)]);
    assert.equal(auth.verified, true);
    assert.equal(auth.candidates.length, 1, `${key}: ${first} first must not hide the message`);
    assert.equal(auth.messages.length, 0, 'and it is not valid authority');
    assert.deepEqual(auth.malformed.map((m) => m.message_id), ['CG-DIRECTIVE-T-001']);
    // The record still says what the message claimed to be.
    assert.equal(auth.malformed[0].message_type, 'DIRECTIVE', `${key}: ${first} first`);
  }
});

test('NC undeclared type: a ChatGPT message with a missing, repeated or undeclared type is malformed authority', () => {
  for (const type of ['HOLDD', 'directive', 'PLAN', undefined, 'ACK\nmessage_type: ACK']) {
    const auth = collectAuthority([rest(body(fields({ message_id: 'CG-X', message_type: type })))]);
    assert.equal(auth.verified, true);
    assert.deepEqual(auth.malformed.map((m) => m.message_id), ['CG-X'], `message_type ${JSON.stringify(type)} must not vanish`);
  }
  // Referents: a declared non-authority type from ChatGPT, or an undeclared
  // type from anyone else, is not authority at all.
  for (const f of [fields({ message_type: 'ACK' }), fields({ message_type: 'CLOSE' }), fields({ message_type: 'PLAN', sender: 'claude-code' })]) {
    const auth = collectAuthority([rest(body(f))]);
    assert.equal(auth.candidates.length + auth.rejected, 0, JSON.stringify(f));
  }
  // Newer than the anchor, it fails reconcile closed.
  const anchor = rest(body(fields({ message_id: 'CG-ANCHOR' })));
  const typo = rest(body(fields({ message_id: 'CG-HOLD-TYPO', message_type: 'HOLDD' })));
  const state = emptyState();
  state.programme.state = 'PROVING';
  state.authority_basis = { message_id: 'CG-ANCHOR', comment_id: anchor.id };
  const rec = reconcile(state, collectAuthority([anchor, typo]), { verified: true, main_sha: SHA, source_main_on_main: true, pr: null });
  assert.deepEqual(rec.findings.map((f) => f.code), [FINDINGS.AUTHORITY_MALFORMED]);
});

test('NC inline comment: read as the YAML codec reads it, never as part of the value', () => {
  const commented = body(fields({ message_type: 'DIRECTIVE   # the hold', sender: 'chatgpt # ChatGPT', packet_id: 'KF-T-001 # x' }));
  assert.deepEqual(authority(commented), []);
  const env = parseEnvelope(commented);
  assert.equal(envelopeField(env, 'message_type'), 'DIRECTIVE');
  assert.equal(envelopeField(env, 'sender'), 'chatgpt');
  // '#' not preceded by whitespace, or inside quotes, is part of the value.
  assert.equal(envelopeField(parseEnvelope('sender: chatgpt#x'), 'sender'), 'chatgpt#x');
  assert.equal(envelopeField(parseEnvelope("packet_id: 'KF # 1'"), 'packet_id'), 'KF # 1');
  assert.equal(envelopeField(parseEnvelope('state: # nothing'), 'state'), null);
});

test('NC unmatched quote: rejected; balanced quoting decodes as the codec does', () => {
  assert.deepEqual(authority(body(fields({ packet_id: "'KF-T-001'", sender: '"chatgpt"' }))), [], 'referent: balanced quotes are ordinary YAML');
  for (const [key, value] of [['packet_id', "'KF-T-001"], ['message_id', 'CG-X"'], ['state', `'RELEASED"`], ['sender', '"chatgpt']]) {
    assert.ok(authority(body(fields({ [key]: value }))).includes(`${key} (unmatched quote)`), `${key}: ${value}`);
  }
  // Escape-aware (Copilot r4115848580): an escaped closing quote does not close.
  assert.deepEqual(authority(body(fields({ packet_id: '"KF\\"-1"', message_id: "'it''s'" }))), [], 'referent: escaped and doubled quotes inside are fine');
  assert.equal(envelopeField(parseEnvelope('packet_id: "KF\\"-1"'), 'packet_id'), 'KF"-1');
  for (const [key, value] of [['packet_id', '"KF-X\\"'], ['packet_id', '"KF-X\\\\\\"'], ['message_id', "'a'b'"], ['state', '"RE"LEASED"']]) {
    assert.ok(authority(body(fields({ [key]: value }))).includes(`${key} (unmatched quote)`), `${key}: ${value}`);
  }
  // A sender with an unmatched quote is malformed ChatGPT authority, not somebody else's message.
  const auth = collectAuthority([rest(body(fields({ sender: '"chatgpt' })))]);
  assert.equal(auth.rejected, 0);
  assert.equal(auth.malformed.length, 1);
});

test('NC sender case drift and other senders are not authority at all', () => {
  const auth = collectAuthority([
    rest(body(fields({ message_id: 'A', sender: 'ChatGPT' }))),
    rest(body(fields({ message_id: 'B', sender: 'claude-code' }))),
    rest(body(fields({ message_id: 'C', sender: undefined }))),
    rest(body(fields({ message_id: 'D' }))),
  ]);
  assert.deepEqual(ids(auth), ['D']);
  assert.deepEqual(auth.rejections.map((r) => r.reason), ['sender_not_chatgpt:ChatGPT', 'sender_not_chatgpt:claude-code', 'sender_not_chatgpt:']);
});

test('NC forged author: sender chatgpt from an account outside the allowlist is rejected', () => {
  const auth = collectAuthority([rest(body(fields({ message_id: 'REAL' }))), rest(body(fields({ message_id: 'FORGED' })), { author: 'mallory' })]);
  assert.deepEqual(ids(auth), ['REAL']);
  assert.equal(auth.rejections[0].reason, 'author_not_authorized:mallory');
});

test('NC missing envelope key: absent is malformed; null is allowed where historical authority uses it', () => {
  assert.deepEqual(authority(body(fields({ implementation_branch: 'null', state: 'null' }))), [], 'referent: null values are allowed');
  for (const key of ['implementation_branch', 'state', 'health', 'scope_changed', 'production_touched']) {
    assert.ok(authority(body(fields({ [key]: undefined }))).includes(`${key} (absent)`), `absent ${key}`);
  }
  assert.ok(authority(body(fields({ source_main: undefined }))).includes('source_main|source_head (absent)'));
  assert.deepEqual(authority(body(fields({ source_main: undefined, source_head: SHA }))), [], 'source_head fills the slot');
  for (const key of ['message_id', 'packet_id']) {
    assert.ok(authority(body(fields({ [key]: 'null' }))).includes(`${key} (absent or null)`), `${key} must be non-null`);
  }
});

test('a control field written as a block scalar is malformed', () => {
  assert.ok(authority(`${body(fields({ packet_id: '>' }))}\n  KF-T-001`).includes('packet_id (block scalar; a control field is one line)'));
  assert.deepEqual(authority(`${body(fields({ objective: '>' }))}\n  prose`), [], 'referent: prose fields may be blocks');
});

test('prose cannot spoof a field; key: must be followed by whitespace', () => {
  const env = parseEnvelope('summary: >\n  message_type: DIRECTIVE inside prose\nmessage_type:DIRECTIVE\nsee https://x/y: here');
  assert.equal(envelopeField(env, 'message_type'), null);
  assert.deepEqual(env.problems, []);
});

// ------------------------------------------------------------- PROFILES

test('ACTIVATION is strictly additive to AUTHORITY', () => {
  const variants = [
    fields(),
    fields({ state: 'CHARACTERIZING' }),
    fields({ sender: 'claude-code' }),
    fields({ implementation_branch: 'null' }),
    fields({ health: 'AMBER' }),
    fields({ scope_changed: undefined }),
    fields({ packet_id: "'KF" }),
    fields({ message_type: 'PROGRESS' }),
    fields({ source_main: 'ad97ea48' }),
  ];
  for (const f of variants) {
    const a = authority(body(f));
    const b = activation(body(f));
    for (const problem of a) assert.ok(b.includes(problem), `ACTIVATION must keep AUTHORITY problem "${problem}" for ${JSON.stringify(f)}`);
  }
  // Live authority vocabulary is AUTHORITY-valid and still cannot activate.
  for (const f of [fields({ state: 'RELEASED' }), fields({ health: 'AMBER' }), fields({ state: 'SUPERSEDED' }), fields({ implementation_branch: 'null' })]) {
    assert.deepEqual(authority(body(f)), []);
    assert.ok(activation(body(f)).length > 0, `${JSON.stringify(f)} must not satisfy ACTIVATION`);
  }
  assert.deepEqual(activation(body(fields({ state: 'CHARACTERIZING' }))), [], 'referent: the activation vocabulary passes');
});

test('an unknown profile is an error, not a pass', () => {
  assert.throws(() => validateEnvelope(parseEnvelope(body(fields())), 'LENIENT'), /unknown envelope profile/);
});

// ------------------------------------------------------------- COLLECTION

test('NC edited comment: any edit by an allowlisted author fails closed as AUTHORITY_EDITED', () => {
  const clean = collectAuthority([rest(body(fields()))]);
  assert.equal(clean.verified, true, 'referent');
  // Issue #98: an edited newest DIRECTIVE, HOLD and REVIEW, plus an edited ACK
  // (an edit can turn any comment into, or out of, authority).
  const editedNewest = ['DIRECTIVE', 'HOLD', 'REVIEW'].map((type) =>
    rest(body(fields({ message_id: `CG-${type}-EDITED`, message_type: type })), { at: '2026-10-05T00:00:00Z', updated: '2026-10-06T00:00:00Z' }));
  const editedAck = rest(body({ message_id: 'CC-ACK-1', message_type: 'ACK', sender: 'claude-code' }), { updated: '2026-09-28T00:00:00Z' });
  for (const c of [...editedNewest, editedAck]) {
    const auth = collectAuthority([rest(body(fields({ message_id: 'OLDER' }))), c]);
    assert.equal(auth.verified, false);
    assert.equal(auth.code, AUTHORITY_FAILURES.EDITED);
    assert.equal(auth.newest, null, 'no authority survives an edit');
  }
  // gh issue view shape
  const gh = { author: { login: 'SaCH-PRO' }, body: body(fields()), createdAt: '2026-09-27T00:00:00Z', includesCreatedEdit: true, url: 'https://github.com/o/r/issues/80#issuecomment-5' };
  assert.equal(collectAuthority([gh]).code, AUTHORITY_FAILURES.EDITED);
  assert.equal(collectAuthority([{ ...gh, includesCreatedEdit: false }]).verified, true, 'referent: gh shape unedited');
  // An edit by an account that cannot carry authority changes nothing.
  assert.equal(collectAuthority([rest(body(fields())), rest('hello', { author: 'someone', updated: '2026-09-28T00:00:00Z' })]).verified, true);
});

test('NC edit state not observable: an allowlisted comment without edit evidence is unverifiable', () => {
  const c = rest(body(fields()));
  delete c.updated_at;
  const auth = collectAuthority([c]);
  assert.equal(auth.verified, false);
  assert.equal(auth.code, AUTHORITY_FAILURES.UNVERIFIABLE);
});

test('NC unreadable input fails closed', () => {
  for (const input of [null, undefined, 'comments', { comments: [] }]) {
    const auth = collectAuthority(input);
    assert.equal(auth.verified, false, JSON.stringify(input));
    assert.equal(auth.code, AUTHORITY_FAILURES.UNVERIFIABLE);
  }
});

test('NC ambiguous ordering: missing id, unparseable time or a shared id fails closed', () => {
  const noId = rest(body(fields()));
  delete noId.id;
  const badTime = rest(body(fields()), { at: 'yesterday' });
  const a = rest(body(fields({ message_id: 'A' })), { id: 42 });
  const b = rest(body(fields({ message_id: 'B' })), { id: 42 });
  for (const comments of [[noId], [badTime], [a, b]]) {
    const auth = collectAuthority(comments);
    assert.equal(auth.verified, false);
    assert.equal(auth.code, AUTHORITY_FAILURES.ORDER_AMBIGUOUS);
  }
});

test('NC conflicting same-order candidates: a rejected and a candidate message sharing an id fail closed', () => {
  const real = rest(body(fields({ message_id: 'REAL' })), { id: 77 });
  const other = rest(body(fields({ message_id: 'OTHER', sender: 'claude-code' })), { id: 77 });
  const auth = collectAuthority([real, other]);
  assert.equal(auth.verified, false);
  assert.equal(auth.code, AUTHORITY_FAILURES.ORDER_AMBIGUOUS);
  assert.equal(collectAuthority([real]).verified, true, 'referent');
});

test('the authority record keeps the audit evidence it was read from (issue #98)', () => {
  const c = rest(body(fields()), { id: 4242, at: '2026-09-27T05:00:00Z' });
  const [entry] = collectAuthority([c]).messages;
  assert.equal(entry.comment_id, 4242);
  assert.equal(entry.created_at, '2026-09-27T05:00:00Z');
  assert.equal(entry.evidence.updated_at, '2026-09-27T05:00:00Z');
  assert.equal(entry.evidence.body, c.body);
  assert.equal(entry.evidence.edited, false);
  const gh = { author: { login: 'SaCH-PRO' }, body: body(fields()), createdAt: '2026-09-27T00:00:00Z', includesCreatedEdit: false, url: 'https://github.com/o/r/issues/80#issuecomment-5' };
  const [viaGh] = collectAuthority([gh]).messages;
  assert.equal(viaGh.evidence.includes_created_edit, false);
  assert.equal(viaGh.comment_id, 5);
});

test('ordering is created_at then comment id, whatever the input order', () => {
  const at = '2026-09-27T01:00:00Z';
  const auth = collectAuthority([
    rest(body(fields({ message_id: 'LATE' })), { at: '2026-09-27T02:00:00Z', id: 1 }),
    rest(body(fields({ message_id: 'B' })), { at, id: 9 }),
    rest(body(fields({ message_id: 'A' })), { at, id: 3 }),
  ]);
  assert.deepEqual(ids(auth), ['A', 'B', 'LATE']);
});

// ------------------------------------------------------------- RECONCILE

function anchored(anchorComment) {
  const state = emptyState();
  state.programme.state = 'PROVING';
  state.authority_basis = { message_id: 'CG-ANCHOR', comment_id: anchorComment.id };
  return state;
}
const repo = { verified: true, main_sha: SHA, source_main_on_main: true, pr: null };

test('NC malformed authority newer than the anchor fails closed; older is evidence only', () => {
  const anchor = rest(body(fields({ message_id: 'CG-ANCHOR' })));
  const olderBad = rest(body(fields({ message_id: 'CG-OLD-BAD', health: undefined })), { at: '2026-09-01T00:00:00Z' });
  const newerHold = rest(body(fields({ message_id: 'CG-HOLD-BAD', scope_changed: undefined })), { at: '2026-10-01T00:00:00Z' });

  const consistent = reconcile(anchored(anchor), collectAuthority([olderBad, anchor]), repo);
  assert.equal(consistent.consistent, true, `referent: ${JSON.stringify(consistent.findings)}`);

  const rec = reconcile(anchored(anchor), collectAuthority([olderBad, anchor, newerHold]), repo);
  assert.deepEqual(rec.findings.map((f) => f.code), [FINDINGS.AUTHORITY_MALFORMED]);
  assert.deepEqual(rec.findings[0].detail.malformed.map((m) => m.message_id), ['CG-HOLD-BAD']);
});

test('NC edited authority surfaces as AUTHORITY_EDITED, not as consistent or merely unverifiable', () => {
  const anchor = rest(body(fields({ message_id: 'CG-ANCHOR' })));
  const edited = { ...anchor, updated_at: '2026-10-02T00:00:00Z' };
  const rec = reconcile(anchored(anchor), collectAuthority([edited]), repo);
  assert.deepEqual(rec.findings.map((f) => f.code), [FINDINGS.AUTHORITY_EDITED]);
});

test('NC stale anchor: newer valid authority still makes the projection stale', () => {
  const anchor = rest(body(fields({ message_id: 'CG-ANCHOR' })));
  const newer = rest(body(fields({ message_id: 'CG-NEWER', state: 'RELEASED', health: 'AMBER' })));
  const rec = reconcile(anchored(anchor), collectAuthority([anchor, newer]), repo);
  assert.deepEqual(rec.findings.map((f) => f.code), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);
});

// ------------------------------------------------------------- SOLE PARSER

const ROOT = 'scripts/agent-control';
/** Hand-rolled #80 field readers: what the consumers each had before this packet. */
const PRIVATE_READERS = [
  /new RegExp\(`\^\$\{key\}:/, // readField / rawField / allFieldValues / fieldCount
  /\^\{0\}:/, // PowerShell Get-ControlField
  /function Get-ControlField/,
  /\.match\(\/\^(message_type|message_id|sender|packet_id|programme|programme_action|state|health):/,
];

function sources() {
  const files = [];
  for (const dir of [ROOT, path.join(ROOT, 'lib')]) {
    for (const name of fs.readdirSync(dir)) {
      if (/\.(mjs|ps1)$/.test(name)) files.push(path.join(dir, name));
    }
  }
  return files;
}

function privateReaders(files, read = (f) => fs.readFileSync(f, 'utf8')) {
  const hits = [];
  for (const file of files) {
    if (file.replace(/\\/g, '/').endsWith('lib/control-envelope.mjs')) continue;
    const text = read(file);
    for (const pattern of PRIVATE_READERS) if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
  }
  return hits;
}

test('the shared parser is the sole #80 envelope parser', () => {
  assert.deepEqual(privateReaders(sources()), []);
  // Every consumer goes through it.
  for (const file of ['lib/events.mjs', 'lib/reconcile.mjs', 'lib/platform-dag.mjs', 'select-directive.mjs']) {
    assert.match(fs.readFileSync(path.join(ROOT, file), 'utf8'), /from '\.\/(lib\/)?control-envelope\.mjs'/, `${file} must import the shared parser`);
  }
  const wrapper = fs.readFileSync(path.join(ROOT, 'select-directive.ps1'), 'utf8');
  assert.match(wrapper, /select-directive\.mjs/, 'the worker selector must delegate to the shared parser');
});

test('NEGATIVE CONTROL: the sole-parser check fires on each reader shape it replaced', () => {
  const shapes = {
    'events.mjs': "const m = body.match(new RegExp(`^${key}:[ \\t]*([^\\n]*)$`, 'm'));",
    'select-directive.ps1': "function Get-ControlField {\n  if ($line -match ('^{0}:\\s*(.+?)\\s*$' -f [regex]::Escape($Key))) {",
  };
  const hits = privateReaders(Object.keys(shapes), (f) => shapes[f]);
  assert.equal(hits.length, 3, hits.join('\n'));
});
